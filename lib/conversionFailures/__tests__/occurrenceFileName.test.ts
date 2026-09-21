/**
 * Regression: both conversion-failure reporters used to store the uploaded
 * file's name. `q3-layoffs-draft.docx` is user content — it discloses
 * something even though the document's text never leaves the browser — and
 * nothing downstream ever read it. The builder is the one place both the
 * browser hook (`hooks/useConversionFailureReporter.ts`) and the server
 * document route (`app/api/documents/extract/route.ts`) pass through, so
 * asserting it here covers both capture paths.
 */
import { describe, expect, it } from "vitest";
import { buildFailureOccurrence, buildSignalOccurrence } from "../occurrence";
import type { UnmappedDetail } from "@/features/converter/engine/validate";
import type { SourceSignal } from "@/features/converter/engine/normalizeSource";

const SENSITIVE_NAME = "q3-layoffs-draft.docx";

const meta = {
  source: "file" as const,
  encodingId: "bijoy",
  engineVersion: "1.0.0",
  rulesHash: "abc123",
  fileName: SENSITIVE_NAME,
  fileType: "docx",
};

const detail: UnmappedDetail = { sequence: "Av", positions: [3], count: 1, contexts: ["abc⟦Av⟧def"] };
const signal: SourceSignal = {
  sequence: "|",
  positions: [3],
  count: 1,
  unicode: "্য",
  message: "Ambiguous vertical bar.",
};

describe("the occurrence builders and the uploaded file's name", () => {
  it("stores the extension, not the name, for an unmapped sequence", () => {
    const occurrence = buildFailureOccurrence(meta, "abcAvdef", detail);
    expect(occurrence.fileName).toBe(".docx");
    expect(occurrence.fileType).toBe("docx");
  });

  it("stores the extension, not the name, for an ambiguous byte", () => {
    const occurrence = buildSignalOccurrence(meta, "abc|def", signal);
    expect(occurrence.fileName).toBe(".docx");
  });

  it("puts the name in no field of the payload at all", () => {
    const occurrence = buildFailureOccurrence(meta, "abcAvdef", detail);
    const serialized = JSON.stringify(occurrence);
    expect(serialized).not.toContain("q3-layoffs-draft");
    expect(serialized).not.toContain(SENSITIVE_NAME);
  });

  it("leaves pasted text with no file fields", () => {
    const occurrence = buildFailureOccurrence(
      { ...meta, source: "text", fileName: null, fileType: null },
      "abcAvdef",
      detail,
    );
    expect(occurrence.fileName).toBeNull();
    expect(occurrence.fileType).toBeNull();
  });
});
