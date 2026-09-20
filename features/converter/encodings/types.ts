/**
 * Data-driven contract for a legacy encoding. Adding a new legacy Bengali
 * font/encoding means adding a new folder under `encodings/` that exports an
 * `EncodingDefinition` and registering it — the engine (`engine/*.ts`) never
 * needs to change.
 */

export type ReorderKind =
  /** Legacy byte appears BEFORE the consonant glyph but must render AFTER it in Unicode (pre-base vowel signs). */
  | "before-consonant"
  /** Legacy byte already appears after the consonant, same as Unicode logical order — no movement needed. */
  | "after-consonant"
  /** Legacy byte is a reph typed AFTER the consonant cluster it visually sits above; Unicode wants it BEFORE. */
  | "reph"
  /** No special reordering — plain passthrough / independent glyph. */
  | "none";

export interface GlyphRule {
  /** The exact legacy character sequence to match (longest matches win). */
  match: string;
  /** The Unicode sequence this legacy sequence maps to. */
  unicode: string;
  reorder?: ReorderKind;
}

export interface Token {
  /** Original legacy source text this token was matched from. */
  legacy: string;
  /** Unicode output for this token, prior to any reordering pass. */
  unicode: string;
  reorder: ReorderKind;
  /** True when no rule matched and the character was passed through unchanged. */
  unmapped?: boolean;
  /**
   * Character offset of `legacy` in the original source text, assigned once
   * by `tokenize` and carried through `postProcess`/`reorderTokens` (which
   * only move/copy token objects, never rebuild them field-by-field) so a
   * failure can still be located in the original input after reordering.
   */
  sourceIndex: number;
}

export interface EncodingDefinition {
  id: string;
  name: string;
  description?: string;
  /**
   * Confidence flag surfaced in the UI/validation output. Legacy font
   * mapping tables are inherently a best-effort, iteratively-corrected
   * artifact — this makes that visible instead of implying false certainty.
   */
  maturity: "experimental" | "stable";
  rules: GlyphRule[];
  /** Optional encoding-specific pass over tokens after tokenizing, before generic reordering. */
  postProcess?: (tokens: Token[]) => Token[];
}
