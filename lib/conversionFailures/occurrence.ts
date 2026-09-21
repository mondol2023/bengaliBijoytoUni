/**
 * Builds the occurrence payload shared by the two conversion-failure
 * reporters: the browser hook (`hooks/useConversionFailureReporter.ts`, text
 * input) and the server document route (`app/api/documents/extract`, file
 * input). Both used to assemble this object inline, and both shipped the
 * entire source document to Firestore. Keeping one builder means the privacy
 * bound below is enforced in one place and cannot drift between the paths.
 *
 * Privacy bound: a report carries the failed sequence plus a bounded window of
 * the original text either side of it, and nothing else derived from the
 * user's content. The complete input (`fullText`) and the complete converted
 * output (`engineOutput`) are deliberately NOT collected — see
 * `docs/conversion-failure-pipeline.md` §6.
 *
 * Client-bundled, so like `./limits.ts` this module must never import
 * `firebase-admin` or anything that reaches it.
 */
import type { UnmappedDetail } from "@/features/converter/engine/validate";
import type { SourceSignal } from "@/features/converter/engine/normalizeSource";

/**
 * Characters of the original input kept either side of a failed sequence.
 * Independent of `validate.ts`'s `CONTEXT_TOKENS` (which windows *tokens* of
 * converted output for the in-app log) — this windows *characters* of the
 * original legacy text, since that is what a human fixing the mapping table
 * needs to see. Must stay <= `CONVERSION_FAILURE_LIMITS.maxContextLength`,
 * which `./limits.test.ts` asserts.
 */
export const CONTEXT_WINDOW_CHARS = 80;

export interface FailureOccurrenceMeta {
  source: "text" | "file" | "comparison" | "api";
  encodingId: string | null;
  engineVersion: string;
  rulesHash: string | null;
  fileName?: string | null;
  fileType?: string | null;
}

export interface BuiltFailureOccurrence {
  source: "text" | "file" | "comparison" | "api";
  encodingId: string | null;
  engineVersion: string;
  rulesHash: string | null;
  failureCategory: "unmapped_character" | "ambiguous_typography";
  failedSequence: string;
  position: number | null;
  contextBefore: string;
  contextAfter: string;
  /**
   * Always null from this builder. The field survives in the stored schema so
   * occurrences recorded before this bound existed still read back, but no new
   * report populates it.
   */
  engineOutput: null;
  errorCode: "UNMAPPED_CHARACTER" | "AMBIGUOUS_TYPOGRAPHY";
  errorReason: string;
  severity: "warning";
  fileName: string | null;
  fileType: string | null;
}

/**
 * `sourceText` is read to slice the context window and is never copied into
 * the result — it stays in the caller's memory and never crosses the wire.
 */
function buildOccurrence(
  meta: FailureOccurrenceMeta,
  sourceText: string,
  part: {
    sequence: string;
    positions: number[];
    failureCategory: BuiltFailureOccurrence["failureCategory"];
    errorCode: BuiltFailureOccurrence["errorCode"];
    errorReason: string;
  },
): BuiltFailureOccurrence {
  const position = part.positions[0] ?? null;
  const contextBefore =
    position === null ? "" : sourceText.slice(Math.max(0, position - CONTEXT_WINDOW_CHARS), position);
  const contextAfter =
    position === null
      ? ""
      : sourceText.slice(
          position + part.sequence.length,
          position + part.sequence.length + CONTEXT_WINDOW_CHARS,
        );

  return {
    source: meta.source,
    encodingId: meta.encodingId,
    engineVersion: meta.engineVersion,
    rulesHash: meta.rulesHash,
    failureCategory: part.failureCategory,
    failedSequence: part.sequence,
    position,
    contextBefore,
    contextAfter,
    engineOutput: null,
    errorCode: part.errorCode,
    errorReason: part.errorReason,
    severity: "warning",
    fileName: meta.fileName ?? null,
    fileType: meta.fileType ?? null,
  };
}

/**
 * An ambiguous source character `normalizeSource` flagged and deliberately
 * left unchanged, recorded as a reviewable pattern. Same privacy bound as an
 * unmapped character: the byte plus a bounded window, nothing else.
 */
export function buildSignalOccurrence(
  meta: FailureOccurrenceMeta,
  sourceText: string,
  signal: SourceSignal,
): BuiltFailureOccurrence {
  return buildOccurrence(meta, sourceText, {
    sequence: signal.sequence,
    positions: signal.positions,
    failureCategory: "ambiguous_typography",
    errorCode: "AMBIGUOUS_TYPOGRAPHY",
    errorReason: signal.message,
  });
}

export function buildFailureOccurrence(
  meta: FailureOccurrenceMeta,
  sourceText: string,
  detail: UnmappedDetail,
): BuiltFailureOccurrence {
  return buildOccurrence(meta, sourceText, {
    sequence: detail.sequence,
    positions: detail.positions,
    failureCategory: "unmapped_character",
    errorCode: "UNMAPPED_CHARACTER",
    errorReason: `"${detail.sequence}" occurred ${detail.count} time(s) with no mapping rule in this encoding.`,
  });
}
