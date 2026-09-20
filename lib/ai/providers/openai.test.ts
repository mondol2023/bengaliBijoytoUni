import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversionResolutionRequest } from "../types";

const baseRequest: ConversionResolutionRequest = {
  encodingId: "legacy-bangla-font-x",
  failedSequence: "abc",
  codePoints: [97, 98, 99],
  engineVersion: "1.0.0",
  rulesHash: "deadbeef",
};

function fakeOkResponse(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  } as Response;
}

function fakeErrorResponse(status: number, body = "error") {
  return { ok: false, status, text: async () => body, json: async () => ({}) } as Response;
}

async function freshOpenAiModule() {
  vi.resetModules();
  return import("./openai");
}

describe("openAiProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is not configured and returns provider_not_configured when OPENAI_API_KEY is unset", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { openAiProvider } = await freshOpenAiModule();
    expect(openAiProvider.isConfigured()).toBe(false);

    const result = await openAiProvider.resolve(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_not_configured");
  });

  it("never calls fetch when not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    global.fetch = vi.fn();
    const { openAiProvider } = await freshOpenAiModule();
    await openAiProvider.resolve(baseRequest);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns a normalized ConversionResolution on a valid response, preserving uncertainty", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(
      fakeOkResponse(
        JSON.stringify({
          candidateConversion: null,
          alternatives: [],
          confidence: null,
          isCertain: false,
          explanation: "No confident mapping found.",
        }),
      ),
    );
    const { openAiProvider } = await freshOpenAiModule();
    const result = await openAiProvider.resolve(baseRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider).toBe("openai");
      expect(result.value.candidateConversion).toBeNull();
      expect(result.value.isCertain).toBe(false);
    }
  });

  it("never sends the API key anywhere in the returned resolution or error", async () => {
    vi.stubEnv("OPENAI_API_KEY", "super-secret-openai-key");
    global.fetch = vi.fn().mockResolvedValue(fakeErrorResponse(403, "forbidden"));
    const { openAiProvider } = await freshOpenAiModule();
    const result = await openAiProvider.resolve(baseRequest);
    expect(JSON.stringify(result)).not.toContain("super-secret-openai-key");
  });

  it("maps a 403 response to provider_authentication_failed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(fakeErrorResponse(403));
    const { openAiProvider } = await freshOpenAiModule();
    const result = await openAiProvider.resolve(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_authentication_failed");
  });

  it("returns provider_invalid_response for malformed provider output", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(fakeOkResponse("{not valid json"));
    const { openAiProvider } = await freshOpenAiModule();
    const result = await openAiProvider.resolve(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_invalid_response");
  });
});
