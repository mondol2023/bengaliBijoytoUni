import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversionResolutionRequest } from "../types";
import { CONVERSION_RESOLUTION_PROMPT_VERSION } from "../promptBuilder";

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
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as Response;
}

function fakeErrorResponse(status: number, body = "error") {
  return { ok: false, status, text: async () => body, json: async () => ({}) } as Response;
}

async function freshGeminiModule() {
  vi.resetModules();
  return import("./gemini");
}

describe("geminiProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is not configured and returns provider_not_configured when GEMINI_API_KEY is unset", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { geminiProvider } = await freshGeminiModule();
    expect(geminiProvider.isConfigured()).toBe(false);

    const result = await geminiProvider.resolve(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_not_configured");
  });

  it("never calls fetch when not configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    global.fetch = vi.fn();
    const { geminiProvider } = await freshGeminiModule();
    await geminiProvider.resolve(baseRequest);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns a normalized ConversionResolution on a valid response", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(
      fakeOkResponse(
        JSON.stringify({
          candidateConversion: "কখগ",
          alternatives: ["কখ"],
          confidence: "high",
          isCertain: true,
          explanation: "Known mapping.",
        }),
      ),
    );
    const { geminiProvider } = await freshGeminiModule();
    const result = await geminiProvider.resolve(baseRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider).toBe("gemini");
      expect(result.value.candidateConversion).toBe("কখগ");
      expect(result.value.promptVersion).toBe(CONVERSION_RESOLUTION_PROMPT_VERSION);
      expect(result.value.engineVersion).toBe(baseRequest.engineVersion);
    }
  });

  it("never sends the API key anywhere in the returned resolution or error", async () => {
    vi.stubEnv("GEMINI_API_KEY", "super-secret-key-value");
    global.fetch = vi.fn().mockResolvedValue(fakeErrorResponse(401, "unauthorized"));
    const { geminiProvider } = await freshGeminiModule();
    const result = await geminiProvider.resolve(baseRequest);
    expect(JSON.stringify(result)).not.toContain("super-secret-key-value");
  });

  it("maps a 401 response to provider_authentication_failed", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(fakeErrorResponse(401));
    const { geminiProvider } = await freshGeminiModule();
    const result = await geminiProvider.resolve(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_authentication_failed");
  });

  it("maps a 429 response to provider_rate_limited", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(fakeErrorResponse(429));
    const { geminiProvider } = await freshGeminiModule();
    const result = await geminiProvider.resolve(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_rate_limited");
  });

  it("maps a 500 response to provider_unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(fakeErrorResponse(500));
    const { geminiProvider } = await freshGeminiModule();
    const result = await geminiProvider.resolve(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_unavailable");
  });

  it("returns provider_invalid_response for malformed provider output, without throwing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(fakeOkResponse("not json at all"));
    const { geminiProvider } = await freshGeminiModule();
    const result = await geminiProvider.resolve(baseRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_invalid_response");
  });

  it("returns provider_timeout when the call does not complete within timeoutMs", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const timer = setTimeout(() => {}, 5_000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;
    const { geminiProvider } = await freshGeminiModule();
    const result = await geminiProvider.resolve(baseRequest, { timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_timeout");
  });
});
