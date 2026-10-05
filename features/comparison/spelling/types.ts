/** Framework-independent shapes for the comparison page's English spellcheck. */

/**
 * The slice of a Hunspell-style checker the engine needs. Injected, so the
 * engine stays pure and unit-testable with a tiny fake instead of a 550KB
 * dictionary; `nspell` satisfies it directly.
 */
export interface SpellChecker {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

/** One flagged word, as offsets into the exact text that was checked. */
export interface Misspelling {
  word: string;
  start: number;
  end: number;
}

/** A flagged word and how often it occurs on one side — one row of the summary. */
export interface MisspelledWord {
  word: string;
  count: number;
}

/**
 * Why a side was not checked. `legacy`: the text is legacy-encoded Bengali
 * (Bijoy and friends), whose Latin-looking bytes are not English at all.
 */
export type SkipReason = "legacy";

export interface SideSpelling {
  skipped: SkipReason | null;
  /** In text order. Empty when `skipped`. */
  misspellings: Misspelling[];
  /** Distinct flagged words, most frequent first. Empty when `skipped`. */
  words: MisspelledWord[];
}

/** A flagged range inside one diff segment's `value`. */
export interface SegmentMark {
  start: number;
  end: number;
  word: string;
}
