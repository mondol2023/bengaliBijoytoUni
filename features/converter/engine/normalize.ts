import type { Token } from "../encodings/types";

/** U+FEFF — byte-order mark when leading, ZERO WIDTH NO-BREAK SPACE elsewhere. */
const BOM = /﻿/gu;

/**
 * Removes U+FEFF from legacy source text.
 *
 * A BOM survives copy/paste out of a Windows-exported file and out of some
 * PDF extractors, and the rule tables have no entry for it, so a leading one
 * used to reach `tokenize` as an unmapped character: a warning on the very
 * first character of an otherwise perfect conversion, plus a junk
 * `failurePatterns` row keyed on U+FEFF.
 *
 * Safe to remove rather than merely flag, unlike the genuinely ambiguous
 * characters (U+2019, U+00AD) that are real byte slots in these tables.
 * These encodings address CP1252 bytes, and every above-Latin-1 character
 * they match is one of the CP1252 0x80–0x9F specials (U+2013, U+2019,
 * U+201C, U+0161, …). U+FEFF is not in CP1252 at all and appears in zero
 * rules across all three encodings, so it can only ever be an artifact of
 * how the text was transported — there is no ambiguity to preserve.
 *
 * Interior occurrences are removed for the same reason, and because leaving
 * them was its own defect: JavaScript's `\s` matches U+FEFF, so
 * `validateTokens` skipped it as whitespace and it passed silently into the
 * converted output (`Av﻿Kv` produced `আ﻿কা`) — an invisible
 * character in text the user is about to paste somewhere that cares.
 */
export function stripBom(text: string): string {
  return text.replace(BOM, "");
}

/** Joins reordered tokens into a single string, prior to normalization. */
export function assembleText(tokens: Token[]): string {
  return tokens.map((token) => token.unicode).join("");
}

/**
 * Applies Unicode Normalization Form C. This is the single normalization
 * implementation shared by both the text-input and document-extraction
 * paths (see `features/documents`), so there is exactly one definition of
 * "normalized" across the app.
 */
export function normalizeText(text: string): string {
  return text.normalize("NFC");
}
