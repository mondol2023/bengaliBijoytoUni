import { describe, expect, it } from "vitest";
import { deriveIssues } from "./useIssueLog";
import type { ValidationResult } from "@/features/converter/engine/pipeline";

const TEXT_CONTEXT = { source: "text" as const, encodingId: "bijoy" };

function validation(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return { valid: true, warnings: [], unmappedSequences: [], ...overrides };
}

describe("deriveIssues", () => {
  it("returns nothing for a clean conversion", () => {
    expect(deriveIssues(TEXT_CONTEXT, { error: null, validation: validation() })).toEqual([]);
  });

  it("returns nothing when there is no outcome yet", () => {
    expect(deriveIssues(TEXT_CONTEXT, {})).toEqual([]);
  });

  it("maps each error code to the kind that describes it", () => {
    const cases = [
      ["FILE_PROCESSING_ERROR", "file_extraction_failed"],
      ["CONVERSION_ERROR", "conversion_failed"],
      ["VALIDATION_ERROR", "conversion_failed"],
      ["LIMIT_EXCEEDED_ERROR", "limit_exceeded"],
      ["RATE_LIMIT_ERROR", "rate_limited"],
    ] as const;

    for (const [code, kind] of cases) {
      const [issue] = deriveIssues(TEXT_CONTEXT, { error: { code, message: "boom" } });
      expect(issue?.kind).toBe(kind);
      expect(issue?.severity).toBe("error");
      expect(issue?.code).toBe(code);
    }
  });

  it("falls back to `unknown` for a code it has no mapping for", () => {
    const [issue] = deriveIssues(TEXT_CONTEXT, {
      error: { code: "STORAGE_ERROR", message: "bucket unreachable" },
    });
    expect(issue?.kind).toBe("unknown");
  });

  it("carries the file context onto the issue", () => {
    const [issue] = deriveIssues(
      { source: "file", encodingId: "sutonnymj", fileName: "report.pdf", fileType: "pdf" },
      { error: { code: "FILE_PROCESSING_ERROR", message: "could not read" } },
    );
    expect(issue).toMatchObject({
      source: "file",
      encodingId: "sutonnymj",
      fileName: "report.pdf",
      fileType: "pdf",
    });
  });

  it("normalises missing context to null rather than undefined", () => {
    const [issue] = deriveIssues(
      { source: "comparison" },
      { error: { code: "CONVERSION_ERROR", message: "boom" } },
    );
    expect(issue).toMatchObject({ encodingId: null, fileName: null, fileType: null });
  });

  it("records unmapped sequences as a single character-level issue", () => {
    const issues = deriveIssues(TEXT_CONTEXT, {
      validation: validation({ valid: false, unmappedSequences: ["Av", "ÿ"] }),
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "unmapped_character",
      severity: "warning",
      code: "UNMAPPED_CHARACTER",
      samples: ["Av", "ÿ"],
    });
  });

  it("does not double-report the prose warning that describes the same unmapped sequences", () => {
    const issues = deriveIssues(TEXT_CONTEXT, {
      validation: validation({
        valid: false,
        warnings: ["2 sequences could not be mapped."],
        unmappedSequences: ["Av", "ÿ"],
      }),
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe("unmapped_character");
  });

  it("caps the number of sampled sequences", () => {
    const sequences = Array.from({ length: 40 }, (_, index) => `seq${index}`);
    const [issue] = deriveIssues(TEXT_CONTEXT, {
      validation: validation({ valid: false, unmappedSequences: sequences }),
    });
    expect(issue?.samples).toHaveLength(20);
  });

  it("reports output warnings that are not about unmapped characters", () => {
    const issues = deriveIssues(TEXT_CONTEXT, {
      validation: validation({
        valid: false,
        warnings: ["Output is not in NFC form.", "Stray matra found."],
      }),
    });

    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.kind === "validation_warning")).toBe(true);
    expect(issues.map((issue) => issue.message)).toEqual([
      "Output is not in NFC form.",
      "Stray matra found.",
    ]);
  });

  it("ignores warnings on a validation that passed", () => {
    expect(
      deriveIssues(TEXT_CONTEXT, { validation: validation({ warnings: ["cosmetic note"] }) }),
    ).toEqual([]);
  });

  it("reports an error and an unmapped-character warning together", () => {
    const issues = deriveIssues(TEXT_CONTEXT, {
      error: { code: "CONVERSION_ERROR", message: "partial failure" },
      validation: validation({ valid: false, unmappedSequences: ["Av"] }),
    });

    expect(issues.map((issue) => issue.kind)).toEqual(["conversion_failed", "unmapped_character"]);
  });
});
