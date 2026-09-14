import { listEncodings } from "../encodings/registry";
import { tokenize } from "./tokenize";

export interface EncodingScore {
  encodingId: string;
  /** Share of non-whitespace tokens that matched a known glyph rule, 0..1. */
  confidence: number;
  /** Share of *legacy-range* (non-ASCII) characters that matched, 0..1. */
  legacyRangeCoverage: number;
}

export interface DetectionResult {
  /** Best-guess encoding id, or undefined if nothing scored confidently. */
  encodingId: string | undefined;
  confidence: number;
  scores: EncodingScore[];
}

/**
 * Below this, auto-detect reports no match rather than converting with a
 * table that clearly is not the right one.
 */
export const MIN_DETECTION_CONFIDENCE = 0.6;

const isLegacyRange = (char: string) => char.codePointAt(0)! > 0x7f;

/**
 * Guesses which registered legacy encoding a piece of text was typed in.
 *
 * Naive byte coverage is not enough on its own: these encodings all reuse
 * the same ASCII letters for *different* glyphs, so a wrong table still
 * "matches" most of a document and returns fluent-looking nonsense (real
 * case: Bijoy's table matches 72% of an alpha-ANSI document). The kars,
 * conjuncts and folas — the parts that actually differ between layouts —
 * live above U+007F, so we score that range separately and take the worse
 * of the two. On the same document Bijoy's legacy-range coverage is 19%.
 */
export function detectEncoding(text: string): DetectionResult {
  const scores: EncodingScore[] = listEncodings().map((encoding) => {
    const tokens = tokenize(text, encoding);

    let total = 0;
    let mapped = 0;
    let legacyTotal = 0;
    let legacyMapped = 0;

    for (const token of tokens) {
      if (/^\s+$/u.test(token.legacy)) continue;
      total += 1;
      if (!token.unmapped) mapped += 1;

      for (const char of token.legacy) {
        if (!isLegacyRange(char)) continue;
        legacyTotal += 1;
        if (!token.unmapped) legacyMapped += 1;
      }
    }

    const coverage = total === 0 ? 0 : mapped / total;
    const legacyRangeCoverage = legacyTotal === 0 ? 1 : legacyMapped / legacyTotal;

    return {
      encodingId: encoding.id,
      confidence: Math.min(coverage, legacyRangeCoverage),
      legacyRangeCoverage,
    };
  });

  scores.sort((a, b) => b.confidence - a.confidence);
  const best = scores[0];
  const confident = best !== undefined && best.confidence >= MIN_DETECTION_CONFIDENCE;

  return {
    encodingId: confident ? best.encodingId : undefined,
    confidence: best?.confidence ?? 0,
    scores,
  };
}
