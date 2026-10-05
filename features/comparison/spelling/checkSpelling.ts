import { isAllowedWord } from "./allowlist";
import { looksLikeLegacyText } from "./legacyGate";
import { extractCandidates, type SpellCandidate } from "./tokenize";
import type { MisspelledWord, Misspelling, SideSpelling, SpellChecker } from "./types";

const MIN_WORD_LENGTH = 3;
/** Inside a letters-only `a/b` chunk, parts this short are codes (`A/C`, `C/O`), not words. */
const MIN_SLASHED_WORD_LENGTH = 4;
/** ALL-CAPS words shorter than this are acronyms (`NEFT`, `RTGS`, `TIN`), not shouting. */
const MIN_ALL_CAPS_LENGTH = 6;

const ROMAN_NUMERAL = /^(?=[ivxlcdm]+$)m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/iu;
const REPEATED_LETTER = /^(.)\1+$/iu;

const isCapitalized = (word: string) => /^[A-Z][a-z']/u.test(word);
const isMixedCase = (word: string) => /[a-z][A-Z]/u.test(word);
const normalize = (word: string) => word.replace(/’/gu, "'");

/**
 * Finds misspelled English words in `text`, as offsets into that exact text.
 *
 * Decides *whether* a word should be judged (references, codes, acronyms,
 * names, Bengali neighbours — see `tokenize.ts` and the spec); the injected
 * `checker` only decides whether a judged word is a real English word.
 */
export function findMisspellings(text: string, checker: SpellChecker): Misspelling[] {
  const candidates = extractCandidates(text);
  const verdicts = new Map<string, boolean>();

  const isCorrect = (word: string): boolean => {
    const key = normalize(word);
    let verdict = verdicts.get(key);
    if (verdict === undefined) {
      verdict = checker.correct(key);
      verdicts.set(key, verdict);
    }
    return verdict;
  };

  // A name used mid-sentence somewhere in the text vouches for the same word
  // opening a sentence elsewhere: "Karim went home. He met Karim."
  const midSentenceNames = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.sentenceStart && isCapitalized(candidate.word)) {
      midSentenceNames.add(candidate.word.toLowerCase());
    }
  }

  // Unknown to the dictionary even in lowercase, and Capitalized: name-shaped
  // ("Uddin"), unlike a Capitalized ordinary word ("Payment").
  const isNameLike = (candidate: SpellCandidate | undefined): boolean =>
    candidate !== undefined && isCapitalized(candidate.word) && !isCorrect(candidate.word.toLowerCase());

  const sitsNextToName = (index: number): boolean => {
    const current = candidates[index];
    const previous = candidates[index - 1];
    const next = candidates[index + 1];
    const joinedBy = (a: SpellCandidate, b: SpellCandidate) => /^[ \t]$/u.test(text.slice(a.end, b.start));
    return (
      (next !== undefined && joinedBy(current, next) && isNameLike(next)) ||
      (previous !== undefined && joinedBy(previous, current) && isNameLike(previous))
    );
  };

  const found: Misspelling[] = [];

  candidates.forEach((candidate, index) => {
    const { word } = candidate;

    if (word.length < (candidate.slashed ? MIN_SLASHED_WORD_LENGTH : MIN_WORD_LENGTH)) return;
    if (isMixedCase(word)) return;
    if (word === word.toUpperCase() && word.length < MIN_ALL_CAPS_LENGTH) return;
    if (isAllowedWord(word)) return;
    if (isCorrect(word)) return;

    // The dictionary rejected it; last reasons it may still be fine.
    if (ROMAN_NUMERAL.test(word) || REPEATED_LETTER.test(word)) return;
    if (isCapitalized(word)) {
      if (!candidate.sentenceStart) return;
      if (midSentenceNames.has(word.toLowerCase())) return;
      if (sitsNextToName(index)) return;
    }

    found.push({ word, start: candidate.start, end: candidate.end });
  });

  return found;
}

/** `findMisspellings` plus the legacy-text gate and the per-word summary one side needs. */
export function checkSpelling(text: string, checker: SpellChecker): SideSpelling {
  if (looksLikeLegacyText(text)) return { skipped: "legacy", misspellings: [], words: [] };

  const misspellings = findMisspellings(text, checker);
  return { skipped: null, misspellings, words: summarizeWords(misspellings) };
}

function summarizeWords(misspellings: Misspelling[]): MisspelledWord[] {
  const byKey = new Map<string, MisspelledWord>();
  for (const { word } of misspellings) {
    const key = word.toLowerCase();
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { word, count: 1 });
  }
  // `Array.prototype.sort` is stable, so equal counts keep first-seen order.
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}
