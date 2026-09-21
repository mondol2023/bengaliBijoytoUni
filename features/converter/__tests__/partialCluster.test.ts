import { describe, expect, it } from "vitest";
import { convertLegacyText } from "../engine/pipeline";
import { hasDanglingPreBaseVowel } from "../engine/reorder";
import { validateUnicodeOutput } from "../engine/validate";
import { tokenize } from "../engine/tokenize";
import { getEncoding } from "../encodings/registry";
import { deriveIssues } from "@/hooks/useIssueLog";

const bijoy = getEncoding("bijoy")!;
const tokensOf = (text: string) => tokenize(text, bijoy);

/**
 * E6. The converter runs on every debounced keystroke, so typing "wK" (কি)
 * passes through the intermediate state "w" — a pre-base vowel sign with no
 * consonant yet. `validateUnicodeOutput` read that bare ি as "likely a
 * reorder defect": the UI flashed a defect warning mid-word and
 * `useIssueLog` filed a `validation_warning` row for a conversion that
 * became correct one keystroke later.
 */
describe("hasDanglingPreBaseVowel", () => {
  it("is true for a lone pre-base vowel", () => {
    expect(hasDanglingPreBaseVowel(tokensOf("w"))).toBe(true);
  });

  it("is false once the consonant arrives", () => {
    expect(hasDanglingPreBaseVowel(tokensOf("wK"))).toBe(false);
  });

  it("is false for an after-consonant kar, which never dangles", () => {
    expect(hasDanglingPreBaseVowel(tokensOf("Kv"))).toBe(false);
  });

  it("is true when a finished word is followed by a new partial cluster", () => {
    expect(hasDanglingPreBaseVowel(tokensOf("Kv w"))).toBe(true);
    expect(hasDanglingPreBaseVowel(tokensOf("Kv ‡"))).toBe(true);
  });

  it("is false again once that second cluster completes", () => {
    expect(hasDanglingPreBaseVowel(tokensOf("Kv wK"))).toBe(false);
  });

  it("is false for empty input", () => {
    expect(hasDanglingPreBaseVowel([])).toBe(false);
  });
});

describe("typing a pre-base cluster one keystroke at a time", () => {
  /** Every prefix of "wK" and of the e-kar form "‡K", as the debounce sees them. */
  const steps: Array<[string, string]> = [
    ["w", "ি"],
    ["wK", "কি"],
    ["‡", "ে"],
    ["‡K", "কে"],
  ];

  for (const [input, expected] of steps) {
    it(`"${input}" converts to "${expected}" with no reorder-defect warning`, () => {
      const result = convertLegacyText(input, "bijoy");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.unicodeText).toBe(expected);
        expect(result.value.validation.warnings).toEqual([]);
        expect(result.value.validation.valid).toBe(true);
      }
    });
  }

  it("files no log row for any intermediate keystroke", () => {
    for (const [input] of steps) {
      const result = convertLegacyText(input, "bijoy");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          deriveIssues({ source: "text", encodingId: "bijoy" }, { validation: result.value.validation }),
        ).toEqual([]);
      }
    }
  });

  it("does not drop the unfinished vowel sign from the output", () => {
    const result = convertLegacyText("Kv w", "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe("কা ি");
  });
});

describe("genuine reorder defects still report", () => {
  it("flags a stray vowel sign that is not the trailing unfinished one", () => {
    const result = validateUnicodeOutput("ক াক", { incompleteCluster: true });
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("reorder defect"))).toBe(true);
  });

  it("flags a stray vowel sign when nothing is mid-cluster", () => {
    const result = validateUnicodeOutput("ি", { incompleteCluster: false });
    expect(result.valid).toBe(false);
  });

  it("keeps the default behaviour for callers that pass no options", () => {
    expect(validateUnicodeOutput("ি").valid).toBe(false);
  });

  it("still reports a non-NFC output while suppressing the cluster warning", () => {
    const decomposed = "ো".normalize("NFD");
    const result = validateUnicodeOutput(decomposed, { incompleteCluster: true });
    expect(result.warnings.some((w) => w.includes("Normalization Form C"))).toBe(true);
  });
});

describe("completed conversions are unaffected", () => {
  it("leaves a full sentence clean", () => {
    const result = convertLegacyText("wkÿv †evW© n‡Z Kw¤úDUvi", "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.unicodeText).toBe("শিক্ষা বোর্ড হতে কম্পিউটার");
      expect(result.value.validation.valid).toBe(true);
    }
  });
});
