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

/**
 * `debug` is printed by `logAppError`, so whatever a parse failure puts there
 * is in the runtime logs. The schema path is pinned to carry no model text:
 * zod 4's issues hold paths, codes and limits, and include the input only
 * when asked to (`reportInput`), which this module must not do.
 *
 * The JSON-parse path is deliberately not pinned either way. Its `cause` is
 * V8's SyntaxError, which quotes a short fragment of the text, and whether
 * that is acceptable is an open privacy decision
 * (docs/rollout-readiness.md §6, "Pending review" 3), not a test's to make.
 */
describe("parseProviderResponseText: what a schema failure leaves in debug", () => {
  const MARKER = "MODELTEXTzq";

  it.each([
    ["an out-of-enum confidence", { confidence: MARKER }],
    ["a wrongly typed candidate", { candidateConversion: [MARKER] }],
    ["an over-long candidate", { candidateConversion: MARKER.repeat(10) }],
    ["an over-long explanation", { explanation: MARKER.repeat(60) }],
    ["a non-boolean isCertain", { isCertain: MARKER }],
    ["an empty alternative beside model text", { alternatives: ["", MARKER] }],
  ])("%s", (_label, override) => {
    const response = {
      candidateConversion: "কখগ",
      alternatives: [],
      confidence: "high",
      isCertain: true,
      explanation: null,
      ...override,
    };
    const result = expectInvalid(JSON.stringify(response));
    if (!result.ok) {
      const debug = JSON.stringify(result.error.debug);
      expect(debug).toContain("response failed schema validation");
      expect(debug).not.toContain(MARKER);
      expect(debug).not.toContain("কখগ");
    }
  });
});
