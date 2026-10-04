/**
 * A provider error's `debug` is printed by `logAppError` (the resolve route's
 * `failResponder`), so whatever an adapter puts there lands in the
 * deployment's runtime logs. A 200 response that the adapter could not read
 * text out of is still a model response — it can carry generated text in a
 * field the adapter does not look at (a refusal, a second part, a tool call).
 * This pins that such a body reaches the log as its shape and its finish
 * reason, and never as its text.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversionResolutionRequest } from "../types";

const SENTINEL = "MODEL_GENERATED_TEXT_SENTINEL_9f3c";

const request: ConversionResolutionRequest = {
  encodingId: "legacy-bangla-font-x",
  failedSequence: "abc",
  codePoints: [97, 98, 99],
  engineVersion: "1.0.0",
  rulesHash: "deadbeef",
};

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(json), json: async () => json } as Response;
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a 200 response with no readable text", () => {
  it("gemini: logs the shape and finish reason, not the generated text", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.resetModules();
    const { geminiProvider } = await import("../providers/gemini");
    global.fetch = vi.fn().mockResolvedValue(
      okResponse({
        candidates: [
          { content: { parts: [{ functionCall: { name: "x", args: { text: SENTINEL } } }] }, finishReason: "STOP" },
        ],
        promptFeedback: { blockReason: "SAFETY" },
      }),
    );

    const result = await geminiProvider.resolve(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider_invalid_response");
    const logged = JSON.stringify(result.error.debug);
    expect(logged).not.toContain(SENTINEL);
    expect(logged).toContain("STOP");
    expect(logged).toContain("SAFETY");
  });

  it("openai: logs the shape and finish reason, not the refusal text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.resetModules();
    const { openAiProvider } = await import("../providers/openai");
    global.fetch = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: null, refusal: SENTINEL }, finish_reason: "content_filter" }],
      }),
    );

    const result = await openAiProvider.resolve(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider_invalid_response");
    const logged = JSON.stringify(result.error.debug);
    expect(logged).not.toContain(SENTINEL);
    expect(logged).toContain("content_filter");
  });

  it("drops a finish reason that is not a short enum-like token", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.resetModules();
    const { geminiProvider } = await import("../providers/gemini");
    global.fetch = vi.fn().mockResolvedValue(
      okResponse({ candidates: [{ content: { parts: [] }, finishReason: `${SENTINEL} and more prose` }] }),
    );

    const result = await geminiProvider.resolve(request);
    if (result.ok) throw new Error("expected a failure");
    expect(JSON.stringify(result.error.debug)).not.toContain(SENTINEL);
  });
});
