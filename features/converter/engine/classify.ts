import type { AppErrorCode } from "@/lib/errors/types";

/**
 * Closed taxonomy every persisted conversion failure is classified into.
 * Kept small and stable on purpose — this is a query/filter dimension for
 * the admin review UI and for future engine fixes, not a place to encode
 * every possible warning string.
 */
export const FAILURE_CATEGORIES = [
  "unmapped_character",
  "invalid_encoding",
  "reorder_defect",
  "normalization_warning",
  "ambiguous_typography",
  "conversion_exception",
  "document_extraction_failure",
  "unknown",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/**
 * Classifies one warning string produced by `validateTokens`/
 * `validateUnicodeOutput`. Matches on stable substrings rather than the
 * full message, since e.g. the unmapped-character warning embeds a count
 * and a sequence list that vary per conversion.
 */
export function classifyValidationWarning(message: string): FailureCategory {
  if (message.includes("no mapping rule")) return "unmapped_character";
  if (message.includes("reorder defect")) return "reorder_defect";
  if (message.includes("Normalization Form C")) return "normalization_warning";
  if (message.includes("is both Latin punctuation and a legacy byte")) return "ambiguous_typography";
  return "unknown";
}

/**
 * Classifies a thrown/returned `AppError` from the conversion or document
 * pipelines. Deliberately maps on `code` alone — call sites that need
 * finer detail (e.g. a specific `FileProcessingError.details.reason`)
 * should still persist that raw detail alongside the category, not fold it
 * in here.
 */
export function classifyAppErrorCode(code: AppErrorCode): FailureCategory {
  switch (code) {
    case "FILE_PROCESSING_ERROR":
      return "document_extraction_failure";
    case "CONVERSION_ERROR":
      return "conversion_exception";
    case "VALIDATION_ERROR":
      return "invalid_encoding";
    default:
      return "unknown";
  }
}
