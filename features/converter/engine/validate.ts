import type { Token } from "../encodings/types";
import type { SourceSignal } from "./normalizeSource";

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
  /**
   * The input was already standards-compliant Unicode Bengali, so there was
   * nothing to convert. Not a failure: see `detectAlreadyUnicode`.
   */
  alreadyUnicode: boolean;
  /**
   * Ambiguous source characters `normalizeSource` flagged and deliberately
   * did not change. Advisory: they do not make the conversion invalid.
   */
  sourceSignals: SourceSignal[];
}

/** The Bengali Unicode block. Legacy CP1252 source text contains none of it. */
const BENGALI_BLOCK = /[\u0980-\u09FF]/u;

/** Characters that carry no evidence either way — spacing and shared punctuation. */
const NEUTRAL = /[\s.,;:!?'"()[\]{}\-\u2010-\u2015\u2018\u2019\u201c\u201d\u2026/%\u200c\u200d]/u;

/**
 * Above this share of Bengali characters, the input is treated as already
 * converted. Deliberately a majority rather than "contains any Bengali":
 * a part-converted document is a real thing a user may want to finish
 * converting, and it should still get honest per-character reporting.
 */
const ALREADY_UNICODE_RATIO = 0.5;

/** The one message the user sees instead of a wall of unmapped characters. */
export const ALREADY_UNICODE_MESSAGE =
  "This text is already Unicode Bengali — there is nothing to convert. Paste legacy (Bijoy/SutonnyMJ) text to use the converter.";

/**
 * Detects input that is already standards-compliant Unicode Bengali.
 *
 * Pasting converted text back into the converter used to be the pipeline's
 * single largest source of noise. Legacy text is CP1252 bytes, so the rule
 * tables contain no Bengali-block characters at all; every Bengali letter in
 * the input therefore missed every rule and was reported as an unmapped
 * character. One ordinary paste produced ~18 distinct "unmapped sequence"
 * warnings and filed ~18 `failurePatterns` rows, one per Bengali letter,
 * none of which any mapping rule could ever fix.
 *
 * Counts only characters that carry evidence: whitespace, shared punctuation
 * and the joiners appear in both legacy and Unicode text and so are ignored.
 */
export function detectAlreadyUnicode(text: string): boolean {
  let bengali = 0;
  let meaningful = 0;

  for (const char of text) {
    if (NEUTRAL.test(char)) continue;
    meaningful += 1;
    if (BENGALI_BLOCK.test(char)) bengali += 1;
  }

  if (meaningful === 0) return false;
  return bengali / meaningful >= ALREADY_UNICODE_RATIO;
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
    alreadyUnicode: false,
    sourceSignals: [],
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
export interface UnicodeOutputOptions {
  /**
   * The conversion ended with a pre-base vowel sign that never found its
   * consonant (`hasDanglingPreBaseVowel`). The trailing mark run is then an
   * unfinished cluster — someone mid-keystroke — not a reorder defect, so it
   * is excluded from the stray-mark check. A stray mark anywhere else in the
   * text is still reported.
   */
  incompleteCluster?: boolean;
}

/** A run of dependent vowel signs at the very end of the text. */
const TRAILING_MARKS = /[া-ৌৗ]+$/u;

export function validateUnicodeOutput(
  text: string,
  options: UnicodeOutputOptions = {},
): ValidationResult {
  const warnings: string[] = [];

  if (text !== text.normalize("NFC")) {
    warnings.push("Text is not in Unicode Normalization Form C (NFC).");
  }

  // A Bengali dependent vowel sign (kar) or ৗ with no preceding base
  // consonant usually indicates a reorder defect rather than valid text.
  const subject = options.incompleteCluster ? text.replace(TRAILING_MARKS, "") : text;
  const strayCombiningMark = /(^|\s)[া-ৌৗ]/u;
  if (strayCombiningMark.test(subject)) {
    warnings.push(
      "Found a Bengali vowel sign with no preceding base consonant — likely a reorder defect."
    );
  }

  return {
    valid: warnings.length === 0,
    warnings,
    unmappedSequences: [],
    unmappedDetails: [],
    alreadyUnicode: false,
    sourceSignals: [],
  };
}
