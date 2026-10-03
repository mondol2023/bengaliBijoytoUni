import type { UsageCheck } from "./usageService";

/**
 * The limit-facing count for one text conversion: the body the converter
 * posts to `/api/conversions`, which `recordConversion` turns into the
 * `usage/{uid}` increments (`totalConversions`, `totalCharsProcessed`).
 *
 * Phase 6 §4: a fallback counts as converted, because the engine processed
 * the full input — so the count is the input's, whatever the fallback
 * pipeline then filled. `fallback_unverified` counts exactly as
 * `fallback_accepted`, and an unresolved sequence counts the same way, for
 * the same reason. The parameter type is the guarantee: nothing from
 * `runConversion` reaches it, so the trust-facing breakdown
 * (`conversionBreakdown`) cannot move the count.
 */
export interface ConversionUsageInput {
  readonly encodingId: string;
  /** `checkUsage` on the input — the same check that gated the conversion. */
  readonly usage: UsageCheck;
  /** Words in the input. */
  readonly wordCount: number;
}

export function conversionUsageRecord({ encodingId, usage, wordCount }: ConversionUsageInput) {
  return {
    encodingId,
    inputType: "text" as const,
    charCount: usage.used,
    wordCount,
    fileFormat: null,
    durationMs: 0,
    status: "success" as const,
    error: null,
  };
}
