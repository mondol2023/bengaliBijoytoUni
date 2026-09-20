import { describe, expect, it } from "vitest";
import { parseProviderResponseText } from "./responseSchema";

function expectInvalid(text: string) {
  const result = parseProviderResponseText("gemini", text);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("provider_invalid_response");
  }
  return result;
}

describe("parseProviderResponseText", () => {
  it("accepts a valid structured response", () => {
    const result = parseProviderResponseText(
      "gemini",
      JSON.stringify({
        candidateConversion: "কখগ",
        alternatives: [],
        confidence: "high",
        isCertain: true,
        explanation: "Matches a known legacy Bangla font mapping.",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidateConversion).toBe("কখগ");
      expect(result.value.confidence).toBe("high");
      expect(result.value.isCertain).toBe(true);
    }
  });

  it("accepts a response wrapped in a ```json code fence", () => {
    const fenced = '```json\n{"candidateConversion":"x","alternatives":[],"confidence":"low","isCertain":false,"explanation":null}\n```';
    const result = parseProviderResponseText("openai", fenced);
    expect(result.ok).toBe(true);
  });

  it("rejects a response missing candidateConversion entirely", () => {
    expectInvalid(JSON.stringify({ alternatives: [], confidence: "low", isCertain: false }));
  });

  it("rejects a response where candidateConversion has the wrong type", () => {
    expectInvalid(
      JSON.stringify({ candidateConversion: 12345, alternatives: [], confidence: "low", isCertain: false }),
    );
  });

  it("rejects a response with an invalid confidence value", () => {
    expectInvalid(
      JSON.stringify({
        candidateConversion: "x",
        alternatives: [],
        confidence: "very-high",
        isCertain: false,
      }),
    );
  });

  it("rejects malformed JSON", () => {
    expectInvalid("{ this is not json ");
  });

  it("rejects an empty response body", () => {
    expectInvalid("");
    expectInvalid("   ");
  });

  it("accepts multiple alternatives up to the configured limit", () => {
    const result = parseProviderResponseText(
      "gemini",
      JSON.stringify({
        candidateConversion: "x",
        alternatives: ["a", "b", "c"],
        confidence: "medium",
        isCertain: false,
        explanation: null,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alternatives).toEqual(["a", "b", "c"]);
    }
  });

  it("accepts a certain-no-candidate ('uncertain result') response without forcing a guess", () => {
    const result = parseProviderResponseText(
      "openai",
      JSON.stringify({
        candidateConversion: null,
        alternatives: [],
        confidence: null,
        isCertain: false,
        explanation: "The sequence does not resemble a known legacy encoding.",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidateConversion).toBeNull();
      expect(result.value.isCertain).toBe(false);
    }
  });
});
