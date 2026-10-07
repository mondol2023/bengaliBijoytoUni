/**
 * Clean-up applied to raw engine text, and the script check the UI uses to
 * pick `lang="bn"` per item. Pure and isomorphic.
 */

// Control characters (keeping \t \n \r, handled separately), the BOM, soft hyphen.
// Deliberately NOT ZWJ/ZWNJ: they decide how a Bengali conjunct renders.
const JUNK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­﻿]/g;

/** NFC (matching the converter's output), tidy whitespace, no junk. Returns "" for text with nothing in it. */
export function normalizeOcrText(raw: string): string {
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]/g, " ")
    .replace(JUNK, "")
    .normalize("NFC");

  return cleaned
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const BENGALI_BLOCK = /[ঀ-৿]/;

/**
 * Share of letters, digits and combining marks that are Bengali script, 0..1.
 * Spaces, punctuation (the danda included) and ZWJ/ZWNJ are ignored; ASCII
 * digits count as *not* Bengali. Empty input is 0, not NaN.
 */
export function bengaliRatio(text: string): number {
  let total = 0;
  let bengali = 0;
  for (const char of text) {
    if (!WORD_CHAR.test(char)) continue;
    total++;
    if (BENGALI_BLOCK.test(char)) bengali++;
  }
  return total === 0 ? 0 : bengali / total;
}

export function isMostlyBengali(text: string): boolean {
  return bengaliRatio(text) >= 0.5;
}
