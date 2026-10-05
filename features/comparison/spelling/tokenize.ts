import { NON_TERMINAL_ABBREVIATIONS } from "./allowlist";

/**
 * A run of English letters worth considering for a spelling check, with just
 * enough context for the checker to decide what to do with it.
 */
export interface SpellCandidate {
  /** The word exactly as written (apostrophes kept, never hyphens or punctuation). */
  word: string;
  start: number;
  end: number;
  /** Came from a letters-only `a/b` chunk, where short parts are codes (`A/C`), not words. */
  slashed: boolean;
  /** First word of a sentence or line — where a Capitalized word may be a plain typo, not a name. */
  sentenceStart: boolean;
}

/**
 * A whitespace-delimited chunk is a *reference*, not prose, when it holds a
 * digit (ASCII or Bengali) or a character prose does not use: case numbers
 * (`123/2020`), land records (`45/B`, `Dag 12/3`), bill and account numbers
 * (`A/C 0012-3456`, `Rs.5000/-`), e-mail, paths, URLs, identifiers. The whole
 * chunk is skipped — one letter in `45/B` or `BR12345` proves nothing about
 * spelling, and these are everywhere in the documents this tool compares.
 */
const REFERENCE_CHUNK =
  /[0-9০-৯@\\_#=<>|~^]|:\/\/|^www\.|\.(?:com|org|net|gov|edu|bd|info|io|co)(?:\b|\/|$)/iu;

/** Latin letters, with an inner apostrophe (straight or typographic) kept: `don't`, `dog’s`. */
const WORD_RUN = /[A-Za-z]+(?:['’][A-Za-z]+)*/gu;

const NON_ASCII_WORD_CHAR = /[^\x00-\x7f]/u;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;

/** Characters that may sit between a sentence boundary and its first word. */
const OPENERS = /[\s"'“‘(\[{«\-–—•*]/u;

/**
 * A letter glued to a non-ASCII letter, mark or digit is not English: it is
 * Bengali (or an accented word) with a few Latin characters mixed in, or the
 * fringe of a legacy-encoded run.
 */
function touchesForeignScript(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  return (
    (before !== "" && NON_ASCII_WORD_CHAR.test(before) && WORD_CHAR.test(before)) ||
    (after !== "" && NON_ASCII_WORD_CHAR.test(after) && WORD_CHAR.test(after))
  );
}

function isSentenceStart(text: string, start: number): boolean {
  let i = start - 1;
  while (i >= 0) {
    const char = text[i];
    if (char === "\n" || char === "\r") return true;
    if (!OPENERS.test(char)) break;
    i--;
  }
  if (i < 0) return true;

  const char = text[i];
  if (char === "!" || char === "?" || char === "।") return true;
  if (char !== ".") return false;

  // A period ends a sentence unless it ends a title or initial ("Md. Karim", "A. Karim").
  let j = i - 1;
  while (j >= 0 && /[A-Za-z]/u.test(text[j])) j--;
  const previousWord = text.slice(j + 1, i).toLowerCase();
  if (previousWord.length === 1) return false;
  return !NON_TERMINAL_ABBREVIATIONS.has(previousWord);
}

/** Every English word in `text` that is eligible to be checked, in text order. */
export function extractCandidates(text: string): SpellCandidate[] {
  const candidates: SpellCandidate[] = [];

  for (const chunk of text.matchAll(/\S+/gu)) {
    const chunkText = chunk[0];
    if (REFERENCE_CHUNK.test(chunkText)) continue;

    const chunkStart = chunk.index;
    const slashed = chunkText.includes("/");

    for (const run of chunkText.matchAll(WORD_RUN)) {
      const start = chunkStart + run.index;
      const end = start + run[0].length;
      if (touchesForeignScript(text, start, end)) continue;
      candidates.push({
        word: run[0],
        start,
        end,
        slashed,
        sentenceStart: isSentenceStart(text, start),
      });
    }
  }

  return candidates;
}
