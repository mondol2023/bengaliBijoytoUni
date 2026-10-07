/**
 * The decisions around one Tesseract result: re-run with English, keep the
 * better pass, send to the fallback or not. Pure — the engine wrapper and
 * orchestrator (Phase 3) call these; nothing here touches Tesseract.
 *
 * The thresholds come from the Phase 0 spike and are provisional — see
 * `config.ts`. Per-word confidence is captured on `OcrRecognition.words` so
 * the rule can later become "fraction of words below N" without a type change.
 */
import {
  OCR_ENGLISH_RETRY_CONFIDENCE,
  OCR_FALLBACK_CONFIDENCE,
  OCR_NONTRIVIAL_IMAGE_PIXELS,
} from "../config";
import { normalizeOcrText } from "../postprocess";
import type { FallbackDecision, OcrRecognition } from "../types";

/**
 * `ben` alone is useless on English (the spike's English page: 84% CER, conf
 * 38) but `ben+eng` hurts Bengali pages, so English is only tried when the
 * Bengali-only pass came back poor.
 */
export function needsEnglishRetry(first: OcrRecognition): boolean {
  return first.lang === "ben" && first.confidence < OCR_ENGLISH_RETRY_CONFIDENCE;
}

/** The second pass replaces the first only when it is strictly more confident. */
export function pickBetterRecognition(first: OcrRecognition, second: OcrRecognition): OcrRecognition {
  return second.confidence > first.confidence ? second : first;
}

/**
 * Whether the result should go to the AI fallback. `imagePixels` is the
 * decoded image's area: empty output only means "missed it" on an image big
 * enough to plausibly hold text, so a small blank one is accepted as blank.
 */
export function assessFallback(result: OcrRecognition, imagePixels: number): FallbackDecision {
  if (normalizeOcrText(result.text) === "") {
    return imagePixels >= OCR_NONTRIVIAL_IMAGE_PIXELS
      ? { needed: true, reason: "empty-output" }
      : { needed: false };
  }
  return result.confidence < OCR_FALLBACK_CONFIDENCE
    ? { needed: true, reason: "low-confidence" }
    : { needed: false };
}
