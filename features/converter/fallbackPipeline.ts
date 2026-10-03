/**
 * What `useConversion` does with `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE`, as
 * pure functions, so the flag's two branches can be tested without a DOM.
 *
 * ## Off is the pre-Phase-6 converter, exactly
 *
 * Off, `computeConversion` calls `convertLegacyText` and nothing else — the
 * same call, with the same arguments, the hook made before this module
 * existed — and `snapshotRequest` returns null, so no snapshot is fetched.
 * `fallback` is null, and the output panel renders the engine's text the way
 * it always did.
 *
 * ## On adds, and never replaces
 *
 * On, `runConversion` runs instead. Its `conversion` is the engine's own
 * result, unmodified (`runConversion.ts`), so `output` — what Copy,
 * Download, Save to history, the conversion warnings and the failure
 * reporter read — is the same object either way. Only the rendered text
 * changes: the filled segments are shown, marked, from `fallback.segments`.
 * Copy and Download keep the engine's text, with its gaps, because a filled
 * sequence is one admin's judgement and must not leave the page unmarked.
 *
 * ## Usage
 *
 * Tier limits are `checkUsage` on the *input* (`features/usage`), and the
 * recorded count is `conversionUsageRecord`, which takes no fallback result —
 * so a sequence filled from the store, filled from an unverified entry, or
 * left unresolved costs the same (Phase 6 §4). `ConversionBreakdown` below is
 * the trust-facing view and feeds nothing that is counted.
 */
import { computeRulesHash, convertLegacyText, type ConversionOutput } from "./engine/pipeline";
import { getEncoding } from "./encodings/registry";
import { runConversion, type ResolutionSource, type RunConversionResult } from "./runConversion";
import type { LoadResolutionSourceOptions } from "./resolutionSource";
import type { AppError } from "@/lib/errors/types";

export interface ComputedConversion {
  /** The engine's output; identical whether the pipeline is on or off. */
  readonly output: ConversionOutput | null;
  readonly error: AppError | null;
  /** Null exactly when the pipeline is off (or the conversion failed). */
  readonly fallback: RunConversionResult | null;
}

export interface ComputeConversionOptions {
  readonly text: string;
  readonly encodingId: string;
  readonly pipelineEnabled: boolean;
  /** Ignored when the pipeline is off. */
  readonly resolutions?: ResolutionSource;
  /** Passed through to `runConversion`; omitted means the real flag. */
  readonly serveUnverified?: boolean;
}

export function computeConversion(options: ComputeConversionOptions): ComputedConversion {
  if (!options.pipelineEnabled) {
    const result = convertLegacyText(options.text, options.encodingId);
    return result.ok
      ? { output: result.value, error: null, fallback: null }
      : { output: null, error: result.error, fallback: null };
  }

  const result = runConversion({
    text: options.text,
    encodingId: options.encodingId,
    resolutions: options.resolutions,
    serveUnverified: options.serveUnverified,
  });
  return result.ok
    ? { output: result.value.conversion, error: null, fallback: result.value }
    : { output: null, error: result.error, fallback: null };
}

/**
 * The snapshot fetch for one encoding, or null for none. Off, there is never
 * a fetch; on, one per encoding (and rules table), never per keystroke.
 */
export function snapshotRequest(
  pipelineEnabled: boolean,
  encodingId: string | undefined,
): LoadResolutionSourceOptions | null {
  if (!pipelineEnabled || !encodingId) return null;
  const encoding = getEncoding(encodingId);
  if (!encoding) return null;
  return { encodingId, rulesHash: computeRulesHash(encoding) };
}

/** The line under the output: what was converted, what was filled, what is still a gap. */
export interface ConversionBreakdown {
  /** Words in the input — the same count the input panel shows. Fallbacks and gaps count. */
  readonly wordsConverted: number;
  /** Occurrences filled from a stored resolution, accepted or unverified. */
  readonly filled: number;
  /** Occurrences still shown as raw legacy bytes. */
  readonly unresolved: number;
}

export function conversionBreakdown(
  fallback: RunConversionResult,
  wordCount: number,
): ConversionBreakdown {
  let filled = 0;
  let unresolved = 0;
  for (const segment of fallback.segments) {
    if (segment.state === "fallback_accepted" || segment.state === "fallback_unverified") filled += 1;
    else if (segment.state === "unresolved") unresolved += 1;
  }
  return { wordsConverted: wordCount, filled, unresolved };
}

/** "1,240 words converted · 12 filled from stored resolutions · 3 unresolved" */
export function formatBreakdown(breakdown: ConversionBreakdown): string {
  const words = breakdown.wordsConverted;
  return [
    `${words.toLocaleString()} ${words === 1 ? "word" : "words"} converted`,
    `${breakdown.filled.toLocaleString()} filled from stored resolutions`,
    `${breakdown.unresolved.toLocaleString()} unresolved`,
  ].join(" · ");
}
