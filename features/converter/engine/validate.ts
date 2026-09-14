import type { Token } from "../encodings/types";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  unmappedSequences: string[];
}

/**
 * Validates the token stream produced during a conversion. Unmapped
 * sequences are surfaced here, never silently dropped or mangled — this is
 * what lets the UI tell a user "these N characters had no known mapping"
 * instead of returning subtly wrong output with no explanation.
 */
export function validateTokens(tokens: Token[]): ValidationResult {
  const unmapped = tokens.filter((token) => token.unmapped);
  const unmappedSequences = Array.from(new Set(unmapped.map((token) => token.legacy)));
  const warnings: string[] = [];

  if (unmappedSequences.length > 0) {
    warnings.push(
      `${unmapped.length} character(s) had no mapping rule and were passed through unchanged: ${unmappedSequences.join(", ")}`
    );
  }

  return {
    valid: unmappedSequences.length === 0,
    warnings,
    unmappedSequences,
  };
}

/**
 * Lightweight sanity check for a block of text that is supposed to already
 * be standards-compliant Unicode (e.g. before it enters the comparison
 * engine, or after a conversion result is assembled). Distinct from
 * `validateTokens`, which runs *during* a conversion when the legacy token
 * mapping is still available — this one only has the final text to work
 * with, so its checks are necessarily coarser.
 */
export function validateUnicodeOutput(text: string): ValidationResult {
  const warnings: string[] = [];

  if (text !== text.normalize("NFC")) {
    warnings.push("Text is not in Unicode Normalization Form C (NFC).");
  }

  // A Bengali dependent vowel sign (kar) or ৗ with no preceding base
  // consonant usually indicates a reorder defect rather than valid text.
  const strayCombiningMark = /(^|\s)[া-ৌৗ]/u;
  if (strayCombiningMark.test(text)) {
    warnings.push(
      "Found a Bengali vowel sign with no preceding base consonant — likely a reorder defect."
    );
  }

  return { valid: warnings.length === 0, warnings, unmappedSequences: [] };
}
