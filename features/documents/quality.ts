/**
 * How much of a document the deterministic engine actually converted, as one
 * 0..1 score — and the line below which the AI transcription takes over.
 *
 * Two independent ways a conversion falls short, multiplied because each one
 * scales what the other could deliver:
 *
 * - **Mapping**: of the legacy text the engine saw, the share it had rules
 *   for (`detectEncoding`'s confidence: the worse of token coverage and
 *   legacy-range coverage). A wrong or incomplete table lowers this.
 * - **Coverage**: of the document's pages, the share whose text is in the
 *   text layer at all. A page drawn as images contributes nothing the
 *   engine can read, however good its tables are — the court judgment that
 *   motivated this had 9 such pages and returned only a header.
 *
 * Pure and isomorphic: the extract route computes it, the client reads it to
 * decide whether to call the AI route. Nothing here imports `lib/ai`.
 */

/** Below this, the result is not good enough to stand on its own. */
export const AI_FALLBACK_THRESHOLD = 0.8;

export type QualityReason = "low-mapping" | "image-pages";

export interface ConversionQuality {
  /** 0..1 — `mapping × coverage`, rounded to two decimals. */
  score: number;
  mapping: number;
  coverage: number;
  /** Which factors fell short, for the explanation shown next to the score. */
  reasons: QualityReason[];
}

export function assessConversionQuality(input: {
  /** Mapping confidence of the converted legacy text, 0..1. */
  confidence: number;
  pageCount?: number | null;
  imageTextPages?: readonly number[] | null;
}): ConversionQuality {
  const mapping = clamp01(input.confidence);
  const pages = input.pageCount ?? 0;
  const imagePages = input.imageTextPages?.length ?? 0;
  const coverage = pages > 0 ? clamp01((pages - imagePages) / pages) : 1;

  const reasons: QualityReason[] = [];
  if (mapping < AI_FALLBACK_THRESHOLD) reasons.push("low-mapping");
  if (imagePages > 0) reasons.push("image-pages");

  return { score: Math.round(mapping * coverage * 100) / 100, mapping, coverage, reasons };
}

export function needsAiFallback(quality: ConversionQuality | null | undefined): boolean {
  return quality != null && quality.score < AI_FALLBACK_THRESHOLD;
}

/**
 * Extract-route failures the engine cannot recover from but a model reading
 * the original file can: a scan with no text layer, and text whose encoding
 * no table recognises. A corrupt or oversize file is not one of them — the
 * AI route would refuse it for the same reason.
 */
export function isAiRecoverableFailure(error: { code: string; message: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "FILE_PROCESSING_ERROR") return /no extractable text/i.test(error.message);
  if (error.code === "VALIDATION_ERROR") {
    return /could not determine a source encoding|could not find any legacy bengali text/i.test(error.message);
  }
  return false;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
