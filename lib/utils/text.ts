/**
 * Shared text-measurement helpers. Usage tiers and UI counters must agree on
 * exactly one definition of "character" and "word" — this is that definition.
 */

/** Counts non-whitespace characters (the unit tier limits are measured in). */
export function countNonWhitespaceChars(text: string): number {
  const matches = text.match(/\S/gu);
  return matches ? matches.length : 0;
}

/** Simple, Unicode-aware word count (splits on whitespace runs). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

/** Splits text into paragraphs on blank lines, dropping empty paragraphs. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
