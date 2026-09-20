import { describe, expect, it } from "vitest";
import { classifyAppErrorCode, classifyValidationWarning } from "./classify";

describe("classifyValidationWarning", () => {
  it("classifies the unmapped-character warning", () => {
    expect(
      classifyValidationWarning('2 character(s) had no mapping rule and were passed through unchanged: @, #')
    ).toBe("unmapped_character");
  });

  it("classifies the reorder-defect warning", () => {
    expect(
      classifyValidationWarning(
        "Found a Bengali vowel sign with no preceding base consonant — likely a reorder defect."
      )
    ).toBe("reorder_defect");
  });

  it("classifies the NFC normalization warning", () => {
    expect(classifyValidationWarning("Text is not in Unicode Normalization Form C (NFC).")).toBe(
      "normalization_warning"
    );
  });

  it("falls back to unknown for an unrecognized message", () => {
    expect(classifyValidationWarning("something unexpected happened")).toBe("unknown");
  });
});

describe("classifyAppErrorCode", () => {
  it("maps FILE_PROCESSING_ERROR to document_extraction_failure", () => {
    expect(classifyAppErrorCode("FILE_PROCESSING_ERROR")).toBe("document_extraction_failure");
  });

  it("maps CONVERSION_ERROR to conversion_exception", () => {
    expect(classifyAppErrorCode("CONVERSION_ERROR")).toBe("conversion_exception");
  });

  it("maps VALIDATION_ERROR to invalid_encoding", () => {
    expect(classifyAppErrorCode("VALIDATION_ERROR")).toBe("invalid_encoding");
  });

  it("falls back to unknown for unrelated error codes", () => {
    expect(classifyAppErrorCode("DATABASE_ERROR")).toBe("unknown");
    expect(classifyAppErrorCode("RATE_LIMIT_ERROR")).toBe("unknown");
  });
});
