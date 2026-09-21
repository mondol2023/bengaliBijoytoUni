import { describe, expect, it } from "vitest";
import { convertLegacyText, convertDocument } from "../engine/pipeline";
import { ALREADY_UNICODE_MESSAGE, detectAlreadyUnicode } from "../engine/validate";
import { listEncodings } from "../encodings/registry";
import { deriveIssues } from "@/hooks/useIssueLog";

/**
 * E4. Legacy text is CP1252 bytes, so the rule tables contain no
 * Bengali-block characters at all. Pasting already-converted Unicode
 * therefore missed every rule: one ordinary paste produced ~18 distinct
 * "unmapped sequence" warnings and filed ~18 `failurePatterns` rows, one per
 * Bengali letter, none of which any mapping rule could ever fix. It was the
 * pipeline's largest single source of unactionable noise.
 */
const UNICODE_BENGALI = "শিক্ষা বোর্ড হতে কম্পিউটার ডিপ্লোমা";
const LEGACY = "wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv";

describe("detectAlreadyUnicode", () => {
  it("recognises Unicode Bengali", () => {
    expect(detectAlreadyUnicode(UNICODE_BENGALI)).toBe(true);
  });

  it("does not fire on legacy text", () => {
    expect(detectAlreadyUnicode(LEGACY)).toBe(false);
  });

  it("does not fire on empty or whitespace-only input", () => {
    expect(detectAlreadyUnicode("")).toBe(false);
    expect(detectAlreadyUnicode("   \n\t ")).toBe(false);
  });

  it("ignores punctuation and digits, which prove nothing either way", () => {
    expect(detectAlreadyUnicode("... ,,, !!!")).toBe(false);
  });

  it("leaves a mostly-legacy mixed document to normal reporting", () => {
    expect(detectAlreadyUnicode(`${LEGACY} ${LEGACY} শিক্ষা`)).toBe(false);
  });
});

describe("converting already-Unicode input", () => {
  const result = convertLegacyText(UNICODE_BENGALI, "bijoy");

  it("succeeds rather than erroring", () => {
    expect(result.ok).toBe(true);
  });

  it("returns the text unchanged", () => {
    if (result.ok) expect(result.value.unicodeText).toBe(UNICODE_BENGALI);
  });

  it("reports one friendly message instead of a wall of unmapped characters", () => {
    if (result.ok) {
      expect(result.value.validation.warnings).toEqual([ALREADY_UNICODE_MESSAGE]);
      expect(result.value.validation.alreadyUnicode).toBe(true);
    }
  });

  it("files nothing for the conversion-failure pipeline", () => {
    if (result.ok) {
      expect(result.value.validation.unmappedDetails).toEqual([]);
      expect(result.value.validation.unmappedSequences).toEqual([]);
    }
  });

  it("is not a failure, so nothing reaches the error log either", () => {
    if (result.ok) {
      expect(result.value.validation.valid).toBe(true);
      expect(
        deriveIssues({ source: "text", encodingId: "bijoy" }, { validation: result.value.validation }),
      ).toEqual([]);
    }
  });

  it("behaves the same whichever encoding the user picked", () => {
    for (const encoding of listEncodings()) {
      const perEncoding = convertLegacyText(UNICODE_BENGALI, encoding.id);
      expect(perEncoding.ok).toBe(true);
      if (perEncoding.ok) {
        expect(perEncoding.value.validation.alreadyUnicode).toBe(true);
        expect(perEncoding.value.validation.unmappedDetails).toEqual([]);
      }
    }
  });

  it("applies on the document path, where the junk rows were written server-side", () => {
    const doc = convertDocument({ extractedText: UNICODE_BENGALI, encodingId: "bijoy" });
    expect(doc.ok).toBe(true);
    if (doc.ok) {
      expect(doc.value.validation.alreadyUnicode).toBe(true);
      expect(doc.value.validation.unmappedDetails).toEqual([]);
    }
  });
});

describe("the guard does not mask real conversions", () => {
  it("leaves a genuine legacy conversion completely untouched", () => {
    const result = convertLegacyText(LEGACY, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.validation.alreadyUnicode).toBe(false);
      expect(result.value.unicodeText).toBe("শিক্ষা বোর্ড হতে কম্পিউটার ডিপ্লোমা");
    }
  });

  it("still reports genuinely unmapped bytes in legacy text", () => {
    const result = convertLegacyText(`${LEGACY}\u0001`, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.validation.alreadyUnicode).toBe(false);
      expect(result.value.validation.unmappedSequences).toEqual(["\u0001"]);
    }
  });
});
