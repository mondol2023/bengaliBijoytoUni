import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversionResolutionRequest } from "../types";
import { CONVERSION_RESOLUTION_PROMPT_VERSION } from "../promptBuilder";
import { OCR_PROMPT_VERSION } from "../ocrPrompt";

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

describe("geminiOcrProvider", () => {
  const originalFetch = global.fetch;
  const images = [
    { mimeType: "image/jpeg" as const, data: Buffer.from([0xff, 0xd8, 0xff, 1]) },
    { mimeType: "image/png" as const, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]) },
  ];
  const answer = JSON.stringify({
    images: [
      { index: 1, text: "ক" },
      { index: 2, text: "খ" },
    ],
  });

  function configure(model: string | null = "test-ocr-model") {
    vi.stubEnv("GEMINI_API_KEY", "super-secret-key-value");
    vi.stubEnv("OCR_GEMINI_MODEL", model ?? undefined);
  }

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["the key is missing", { key: "", model: "m" }],
    ["the model is missing", { key: "k", model: "" }],
  ])("is not configured, and never calls fetch, when %s", async (_name, { key, model }) => {
    vi.stubEnv("GEMINI_API_KEY", key);
    vi.stubEnv("OCR_GEMINI_MODEL", model);
    global.fetch = vi.fn();
    const { geminiOcrProvider } = await freshGeminiModule();
    expect(geminiOcrProvider.isConfigured()).toBe(false);
    const result = await geminiOcrProvider.readImages(images);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_not_configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("has no default model", async () => {
    configure(null);
    const { geminiOcrProvider } = await freshGeminiModule();
    expect(geminiOcrProvider.model).toBe("");
    expect(geminiOcrProvider.isConfigured()).toBe(false);
  });

  it("sends the images in order to the configured model and returns the texts", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(fakeOkResponse(answer));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { geminiOcrProvider } = await freshGeminiModule();
    const result = await geminiOcrProvider.readImages(images);

    expect(result).toEqual({
      ok: true,
      value: { texts: ["ক", "খ"], provider: "gemini", model: "test-ocr-model", promptVersion: OCR_PROMPT_VERSION },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/test-ocr-model:generateContent");
    const body = JSON.parse(init.body as string);
    const inline = body.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData);
    expect(inline.map((p: { inlineData: { data: string } }) => p.inlineData.data)).toEqual(
      images.map((i) => i.data.toString("base64")),
    );
    expect(inline.map((p: { inlineData: { mimeType: string } }) => p.inlineData.mimeType)).toEqual([
      "image/jpeg",
      "image/png",
    ]);
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it.each([
    [429, "provider_rate_limited"],
    [503, "provider_unavailable"],
    [401, "provider_authentication_failed"],
  ])("maps HTTP %i to %s", async (status, code) => {
    configure();
    global.fetch = vi.fn().mockResolvedValue(fakeErrorResponse(status)) as unknown as typeof fetch;
    const { geminiOcrProvider } = await freshGeminiModule();
    const result = await geminiOcrProvider.readImages(images);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it("fails on a 404 (the model is gone) without leaking the key or model URL", async () => {
    configure();
    global.fetch = vi.fn().mockResolvedValue(fakeErrorResponse(404, "no longer available")) as unknown as typeof fetch;
    const { geminiOcrProvider } = await freshGeminiModule();
    const result = await geminiOcrProvider.readImages(images);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const safe = JSON.stringify({ code: result.error.code, message: result.error.message });
      expect(safe).not.toContain("super-secret-key-value");
      expect(safe).not.toContain("generativelanguage");
    }
  });

  it("returns provider_timeout when the call outlives timeoutMs", async () => {
    configure();
    global.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;
    const { geminiOcrProvider } = await freshGeminiModule();
    const result = await geminiOcrProvider.readImages(images, { timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_timeout");
  });

  it("fails the whole call when the answer does not line up with the images", async () => {
    configure();
    const short = JSON.stringify({ images: [{ index: 1, text: "ক" }] });
    global.fetch = vi.fn().mockResolvedValue(fakeOkResponse(short)) as unknown as typeof fetch;
    const { geminiOcrProvider } = await freshGeminiModule();
    const result = await geminiOcrProvider.readImages(images);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_invalid_response");
  });

  it("makes exactly one request per call, even after a failure (no retry)", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(fakeErrorResponse(503));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { geminiOcrProvider } = await freshGeminiModule();
    await geminiOcrProvider.readImages(images);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
