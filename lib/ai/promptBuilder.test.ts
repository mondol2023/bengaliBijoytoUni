import { describe, expect, it } from "vitest";
import { buildResolutionPrompt, CONVERSION_RESOLUTION_PROMPT_VERSION } from "./promptBuilder";
import { RESOLUTION_LIMITS } from "./limits";
import type { ConversionResolutionRequest } from "./types";

const baseRequest: ConversionResolutionRequest = {
  encodingId: "legacy-bangla-font-x",
  failedSequence: "abc",
  codePoints: [97, 98, 99],
  engineVersion: "1.0.0",
  rulesHash: "deadbeef",
};

describe("buildResolutionPrompt", () => {
  it("frames the task as conversion analysis, not translation/summarization/spelling", () => {
    const prompt = buildResolutionPrompt(baseRequest);
    expect(prompt.systemInstruction).toMatch(/not translation/i);
    expect(prompt.systemInstruction).toMatch(/not.*summarization/i);
    expect(prompt.systemInstruction).toMatch(/not.*spelling/i);
  });

  it("is stamped with the current prompt version", () => {
    const prompt = buildResolutionPrompt(baseRequest);
    expect(prompt.promptVersion).toBe(CONVERSION_RESOLUTION_PROMPT_VERSION);
    // v2 is the fenced prompt: user text moved from JSON-quoted values into
    // nonce-delimited data blocks, which is a wording change a stored
    // resolution has to be able to be read against.
    expect(prompt.promptVersion).toBe("v2");
  });

  it("includes the failed sequence and its code points formatted as U+XXXX", () => {
    const prompt = buildResolutionPrompt(baseRequest);
    expect(prompt.userPrompt).toContain("abc");
    expect(prompt.userPrompt).toContain("U+0061 U+0062 U+0063");
  });

  it("omits context when contextBefore/contextAfter are absent", () => {
    const prompt = buildResolutionPrompt(baseRequest, { includeContext: true });
    expect(prompt.userPrompt).not.toContain("Context before");
    expect(prompt.userPrompt).not.toContain("Context after");
  });

  it("excludes context text when includeContext is not set, even if provided", () => {
    const request: ConversionResolutionRequest = {
      ...baseRequest,
      contextBefore: "before-secret",
      contextAfter: "after-secret",
    };
    const prompt = buildResolutionPrompt(request);
    expect(prompt.userPrompt).not.toContain("before-secret");
    expect(prompt.userPrompt).not.toContain("after-secret");
  });

  it("includes context text only when includeContext is explicitly set", () => {
    const request: ConversionResolutionRequest = {
      ...baseRequest,
      contextBefore: "before-visible",
      contextAfter: "after-visible",
    };
    const prompt = buildResolutionPrompt(request, { includeContext: true });
    expect(prompt.userPrompt).toContain("before-visible");
    expect(prompt.userPrompt).toContain("after-visible");
  });

  it("excludes fullText by default, even when present on the request", () => {
    const request: ConversionResolutionRequest = { ...baseRequest, fullText: "the entire document body" };
    const prompt = buildResolutionPrompt(request);
    expect(prompt.userPrompt).not.toContain("the entire document body");
  });

  it("includes fullText only when includeFullText is explicitly set", () => {
    const request: ConversionResolutionRequest = { ...baseRequest, fullText: "the entire document body" };
    const prompt = buildResolutionPrompt(request, { includeFullText: true });
    expect(prompt.userPrompt).toContain("the entire document body");
  });

  it("carries quotes, backslashes and newlines through the fence unchanged", () => {
    // The sequence is legacy bytes, and a quote or a backslash can be one of
    // them. Since v2 it goes in raw rather than JSON-escaped, so the model
    // sees the actual characters — the fence, not the quoting, is what keeps
    // it separate from the instructions.
    const awkward = 'a"b\\c\nd';
    const prompt = buildResolutionPrompt({ ...baseRequest, failedSequence: awkward }, {}, { nonce: () => "n1" });
    expect(prompt.userPrompt).toContain(`<<SEQUENCE:n1>>\n${awkward}\n<</SEQUENCE:n1>>`);
  });

  it("handles Bengali script text without corruption", () => {
    const bengali = "বাংলা লেখা";
    const request: ConversionResolutionRequest = { ...baseRequest, failedSequence: bengali, codePoints: Array.from(bengali).map((c) => c.codePointAt(0)!) };
    const prompt = buildResolutionPrompt(request);
    expect(prompt.userPrompt).toContain(bengali);
  });

  it("truncates very long fullText to the configured limit", () => {
    const longText = "x".repeat(RESOLUTION_LIMITS.maxPromptFullTextLength + 5_000);
    const request: ConversionResolutionRequest = { ...baseRequest, fullText: longText };
    const prompt = buildResolutionPrompt(request, { includeFullText: true }, { nonce: () => "n1" });
    const embedded = /<<FULL_TEXT:n1>>\n(x+)\n<<\/FULL_TEXT:n1>>/.exec(prompt.userPrompt);
    expect(embedded).not.toBeNull();
    expect(embedded![1].length).toBeLessThanOrEqual(RESOLUTION_LIMITS.maxPromptFullTextLength);
  });

  it("truncates very long context to the configured limit", () => {
    const longContext = "y".repeat(RESOLUTION_LIMITS.maxPromptContextLength + 1_000);
    const request: ConversionResolutionRequest = { ...baseRequest, contextBefore: longContext };
    const prompt = buildResolutionPrompt(request, { includeContext: true }, { nonce: () => "n1" });
    const embedded = /<<CONTEXT_BEFORE:n1>>\n(y+)\n<<\/CONTEXT_BEFORE:n1>>/.exec(prompt.userPrompt);
    expect(embedded).not.toBeNull();
    expect(embedded![1].length).toBeLessThanOrEqual(RESOLUTION_LIMITS.maxPromptContextLength);
  });
});
