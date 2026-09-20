import type { Token } from "../encodings/types";

/** One unmapped legacy sequence, with enough context to act on it. */
export interface UnmappedDetail {
  /** The legacy byte/sequence that had no rule. */
  sequence: string;
  /** How many times it occurred in this conversion. */
  count: number;
  /**
   * Up to `MAX_CONTEXTS` windows of converted text around an occurrence,
   * with the unmapped sequence wrapped in ⟦⟧.
   */
  contexts: string[];
  /**
   * Character offsets in the original legacy source text for the same
   * occurrences sampled into `contexts` (same order, same length) — each
   * token's `sourceIndex`, captured at tokenize time so it stays correct
   * even though this function runs on the post-reorder token array.
   */
  positions: number[];
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  unmappedSequences: string[];
  unmappedDetails: UnmappedDetail[];
}

/** Tokens of converted text shown either side of an unmapped sequence. */
const CONTEXT_TOKENS = 8;
/** Distinct occurrences sampled per unmapped sequence. */
const MAX_CONTEXTS = 3;
/** Sequences whose context is spelled out when details are rendered as prose. */
export const MAX_DETAILED_SEQUENCES = 8;

function contextAround(tokens: Token[], index: number): string {
  const before = tokens
    .slice(Math.max(0, index - CONTEXT_TOKENS), index)
    .map((token) => token.unicode)
    .join("");
  const after = tokens
    .slice(index + 1, index + 1 + CONTEXT_TOKENS)
    .map((token) => token.unicode)
    .join("");
  const lead = index - CONTEXT_TOKENS > 0 ? "…" : "";
  const tail = index + 1 + CONTEXT_TOKENS < tokens.length ? "…" : "";
  return `${lead}${before}⟦${tokens[index].legacy}⟧${after}${tail}`.normalize("NFC");
}

/**
 * Validates the token stream produced during a conversion. Unmapped
 * sequences are surfaced here, never silently dropped or mangled — this is
 * what lets the UI tell a user "these N characters had no known mapping"
 * instead of returning subtly wrong output with no explanation.
 *
 * The bare list of distinct bytes this used to report was honest but not
 * actionable: a user looking at "¿, ø, ü, â, æ, Ç, …" has no way to work out
 * what any of them should have been, and no way to hand back something the
 * table can be fixed from. Each sequence now carries its occurrence count
 * and a few windows of the surrounding *converted* text, which is what turns
 * an unmapped byte into a fixture — you can read the Bangla either side and
 * see which conjunct is missing from the middle. Runs on the reordered
 * tokens, so the context matches the output the user is reading.
 */
export function validateTokens(tokens: Token[]): ValidationResult {
  const warnings: string[] = [];
  const bySequence = new Map<string, number[]>();

  tokens.forEach((token, index) => {
    if (!token.unmapped) return;
    const seen = bySequence.get(token.legacy);
    if (seen) seen.push(index);
    else bySequence.set(token.legacy, [index]);
  });

  const unmappedDetails: UnmappedDetail[] = Array.from(bySequence, ([sequence, indices]) => ({
    sequence,
    count: indices.length,
    contexts: indices.slice(0, MAX_CONTEXTS).map((index) => contextAround(tokens, index)),
    positions: indices.slice(0, MAX_CONTEXTS).map((index) => tokens[index].sourceIndex),
  }));

  const unmappedSequences = unmappedDetails.map((detail) => detail.sequence);
  const total = unmappedDetails.reduce((sum, detail) => sum + detail.count, 0);

  if (unmappedSequences.length > 0) {
    warnings.push(
      `${total} character(s) had no mapping rule and were passed through unchanged: ${unmappedSequences.join(", ")}`
    );
  }

  // Most-frequent first: the byte that occurs most is both the most damaging
  // to the output and the easiest to identify from the surrounding words.
  unmappedDetails.sort((a, b) => b.count - a.count);

  return {
    valid: unmappedSequences.length === 0,
    warnings,
    unmappedSequences,
    unmappedDetails,
  };
}

/** One detail rendered as a single line, for consumers that only take prose. */
export function formatUnmappedDetail(detail: UnmappedDetail): string {
  return `"${detail.sequence}" ×${detail.count} — ${detail.contexts.join("  |  ")}`;
}

/**
 * Flattens the details into prose for log rows and other plain-text sinks.
 * The interactive UI renders `unmappedDetails` itself and should not use
 * this — it exists so a persisted log row carries the same context the user
 * saw on screen, not just the bare byte list.
 */
export function formatUnmappedDetails(
  details: UnmappedDetail[],
  limit = MAX_DETAILED_SEQUENCES
): string {
  const shown = details.slice(0, limit);
  const lines = shown.map(formatUnmappedDetail);
  if (details.length > shown.length) {
    lines.push(`…and ${details.length - shown.length} more unmapped sequence(s).`);
  }
  return lines.join("\n");
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

  return { valid: warnings.length === 0, warnings, unmappedSequences: [], unmappedDetails: [] };
}
