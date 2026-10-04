import { describe, expect, it } from "vitest";
import {
  AI_FALLBACK_THRESHOLD,
  assessConversionQuality,
  isAiRecoverableFailure,
  needsAiFallback,
} from "../quality";

describe("assessConversionQuality", () => {
  it("scores a fully mapped, fully selectable document at the top", () => {
    const quality = assessConversionQuality({ confidence: 0.97, pageCount: 4, imageTextPages: [] });
    expect(quality.score).toBe(0.97);
    expect(quality.reasons).toEqual([]);
    expect(needsAiFallback(quality)).toBe(false);
  });

  it("scales by the pages whose text is images — the court judgment that returned only a header", () => {
    // 9 of 11 pages drawn as images: perfect tables still convert 2 pages' worth.
    const quality = assessConversionQuality({
      confidence: 1,
      pageCount: 11,
      imageTextPages: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    });
    expect(quality.coverage).toBeCloseTo(2 / 11);
    expect(quality.score).toBe(0.18);
    expect(quality.reasons).toEqual(["image-pages"]);
    expect(needsAiFallback(quality)).toBe(true);
  });

  it("falls below the bar on mapping alone", () => {
    const quality = assessConversionQuality({ confidence: 0.62 });
    expect(quality.reasons).toEqual(["low-mapping"]);
    expect(needsAiFallback(quality)).toBe(true);
  });

  it("multiplies the two shortfalls, since each scales what the other could deliver", () => {
    const quality = assessConversionQuality({ confidence: 0.9, pageCount: 10, imageTextPages: [1] });
    expect(quality.score).toBe(0.81);
    expect(needsAiFallback(quality)).toBe(false);
  });

  it("treats exactly the threshold as good enough", () => {
    expect(needsAiFallback(assessConversionQuality({ confidence: AI_FALLBACK_THRESHOLD }))).toBe(false);
  });

  it("reads a format with no page count as fully covered, and clamps nonsense input", () => {
    expect(assessConversionQuality({ confidence: 0.9 }).coverage).toBe(1);
    expect(assessConversionQuality({ confidence: Number.NaN }).score).toBe(0);
    expect(assessConversionQuality({ confidence: 3 }).score).toBe(1);
  });

  it("never asks for the AI without a result to judge", () => {
    expect(needsAiFallback(null)).toBe(false);
  });
});

describe("isAiRecoverableFailure", () => {
  it.each([
    ["a scan with no text layer", "FILE_PROCESSING_ERROR", "This PDF has no extractable text — it may be a scanned image without OCR."],
    ["an unrecognised encoding", "VALIDATION_ERROR", "Could not determine a source encoding for this document."],
    ["no legacy text found by font", "VALIDATION_ERROR", "Could not find any legacy Bengali text in this document to convert."],
  ])("hands %s to the AI", (_label, code, message) => {
    expect(isAiRecoverableFailure({ code, message })).toBe(true);
  });

  it.each([
    ["a corrupt file", "FILE_PROCESSING_ERROR", "Could not read this PDF — it may be corrupted or password-protected."],
    ["an oversize file", "FILE_PROCESSING_ERROR", "File is too large — the maximum upload size is 15MB."],
    ["a rate limit", "RATE_LIMIT_ERROR", "Too many requests."],
    ["a tier limit", "LIMIT_EXCEEDED_ERROR", "This document is over your tier's limit."],
  ])("does not hand %s to the AI", (_label, code, message) => {
    expect(isAiRecoverableFailure({ code, message })).toBe(false);
  });
});
