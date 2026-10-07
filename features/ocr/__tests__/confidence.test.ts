import { describe, expect, it } from "vitest";
import {
  OCR_ENGLISH_RETRY_CONFIDENCE,
  OCR_FALLBACK_CONFIDENCE,
  OCR_NONTRIVIAL_IMAGE_PIXELS,
} from "../config";
import { assessFallback, needsEnglishRetry, pickBetterRecognition } from "../engine/confidence";
import type { OcrLanguage, OcrRecognition } from "../types";

function recognition(over: Partial<OcrRecognition> & { confidence: number }): OcrRecognition {
  const lang: OcrLanguage = over.lang ?? "ben";
  return { text: "আমার সোনার বাংলা", lang, words: [], ...over };
}

const BIG = OCR_NONTRIVIAL_IMAGE_PIXELS * 4;

describe("needsEnglishRetry", () => {
  it("retries a ben-only pass that scored like the English page did (38)", () => {
    expect(needsEnglishRetry(recognition({ confidence: 38 }))).toBe(true);
  });

  it("does not retry at or above the cutoff — Bengali pages must stay on ben alone", () => {
    expect(needsEnglishRetry(recognition({ confidence: OCR_ENGLISH_RETRY_CONFIDENCE }))).toBe(false);
    expect(needsEnglishRetry(recognition({ confidence: 91 }))).toBe(false);
  });

  it("never retries a pass that already included English", () => {
    expect(needsEnglishRetry(recognition({ confidence: 20, lang: "ben+eng" }))).toBe(false);
  });

  it("retries an empty ben pass, whose confidence is 0", () => {
    expect(needsEnglishRetry(recognition({ confidence: 0, text: "" }))).toBe(true);
  });
});

describe("pickBetterRecognition", () => {
  const first = recognition({ confidence: 38, text: "junk" });

  it("takes the second pass only when its confidence is higher", () => {
    const second = recognition({ confidence: 90, lang: "ben+eng", text: "A real English sentence." });
    expect(pickBetterRecognition(first, second)).toBe(second);
  });

  it("keeps the first pass on a tie or a worse second pass", () => {
    expect(pickBetterRecognition(first, recognition({ confidence: 38, lang: "ben+eng" }))).toBe(first);
    expect(pickBetterRecognition(first, recognition({ confidence: 12, lang: "ben+eng" }))).toBe(first);
  });
});

describe("assessFallback", () => {
  it("accepts a confident result", () => {
    expect(assessFallback(recognition({ confidence: 91 }), BIG)).toEqual({ needed: false });
  });

  it("accepts exactly the threshold — the rule is strictly below", () => {
    expect(assessFallback(recognition({ confidence: OCR_FALLBACK_CONFIDENCE }), BIG)).toEqual({ needed: false });
  });

  it("flags just under the threshold, where the photographed licence (76) landed", () => {
    expect(assessFallback(recognition({ confidence: OCR_FALLBACK_CONFIDENCE - 0.1 }), BIG)).toEqual({
      needed: true,
      reason: "low-confidence",
    });
    expect(assessFallback(recognition({ confidence: 76 }), BIG)).toEqual({ needed: true, reason: "low-confidence" });
  });

  it("flags empty output on an image big enough to plausibly hold text", () => {
    expect(assessFallback(recognition({ confidence: 0, text: "" }), BIG)).toEqual({
      needed: true,
      reason: "empty-output",
    });
  });

  it("treats whitespace- or junk-only output as empty after normalization", () => {
    expect(assessFallback(recognition({ confidence: 95, text: " \n \u0000 " }), BIG)).toEqual({
      needed: true,
      reason: "empty-output",
    });
  });

  it("does not spend a fallback call on an empty result from a trivially small image", () => {
    expect(assessFallback(recognition({ confidence: 0, text: "" }), OCR_NONTRIVIAL_IMAGE_PIXELS - 1)).toEqual({
      needed: false,
    });
  });

  it("still flags low confidence on a small image that did produce text", () => {
    expect(assessFallback(recognition({ confidence: 40 }), OCR_NONTRIVIAL_IMAGE_PIXELS - 1)).toEqual({
      needed: true,
      reason: "low-confidence",
    });
  });
});
