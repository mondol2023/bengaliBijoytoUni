import type { Token } from "../types";

/** A bare hasant token, i.e. the "&" byte before any fixup below. */
const VIRAMA = "্";
/** Hasant + ZWNJ: the visible hasant, which does not form a ligature. */
const VISIBLE_VIRAMA = "্‌";

/**
 * Consonant pairs that Bangla orthography writes with a *visible* hasant
 * rather than a shaped conjunct, keyed as `before|after`.
 *
 * "&" is dual-purpose (see `map.ts`): the same byte joins two consonants
 * into a conjunct where the font has no ligature for them, and stands for a
 * visible hasant in this handful of clusters. Nothing about the byte itself
 * distinguishes the two — only the consonants either side do, which is why
 * this is a pair lookup and not a mapping rule.
 *
 * Both sources agree on these: banglakit/bondhon (MIT) lists "M&Y", "j&d",
 * "j&f" and "O&³" with an explicit U+200C, and OpenBangla/poriborton (MIT)
 * round-trips the same four. Deliberately kept to what those corroborate —
 * a pair added on a hunch would silently force a visible hasant into a word
 * that should ligate, which is the exact failure this table is meant to
 * avoid. স্প্‌ল is absent because প্ল normally ligates (ডিপ্লোমা), so
 * `map.ts` still spells that one out as the whole sequence "¯c&j".
 */
const VISIBLE_HASANT_PAIRS = new Set(["গ|ণ", "ল|ফ", "ল|ভ", "ঙ|ক্ত"]);

/**
 * cp1252 0xAD (soft hyphen) is Bijoy's narrow la-fola, but PDF and clipboard
 * paths often hand it over as U+2212 (MINUS SIGN). `map.ts` cannot take U+2212
 * as a rule — in alpha-ANSI it is the e-kar, and a Bijoy rule for it would
 * inflate Bijoy's score in `detectEncoding` — so it is resolved here, where
 * detection (which only tokenizes) never looks. Only an unmapped U+2212 is
 * touched, so a future table rule still wins.
 */
const MINUS_SIGN = "−";
const LA_FOLA = "্ল";

function resolveMinusLaFola(token: Token): Token {
  if (!token.unmapped || token.legacy !== MINUS_SIGN) return token;
  return { ...token, unicode: LA_FOLA, unmapped: false };
}

/**
 * U+2018 inside a word is Bijoy's ্তু (wKš‘ কিন্তু, cÖ¯‘Z প্রস্তুত): the byte is
 * 0x91, whose cp1252 rendering is the left single quote. `map.ts` cannot take
 * it as a rule for the same reason as U+2212 — in alpha-ANSI it is জ্ঞ
 * (¢h‘ বিজ্ঞ), so a Bijoy rule would score Bijoy on alpha-ANSI text — and the
 * tokenizer lets it through as punctuation, so there is no unmapped flag to
 * key on. What separates it from a real quote is where it sits: glued to the
 * Bengali letter before it, where a quotation mark never is.
 */
const LEFT_SINGLE_QUOTE = "‘";
const TU_FOLA = "্তু";
const BENGALI_LETTER = /[ঀ-৿]$/u;

function resolveQuoteTu(token: Token, previous: Token | undefined): Token {
  if (token.legacy !== LEFT_SINGLE_QUOTE || token.unicode !== LEFT_SINGLE_QUOTE) return token;
  if (!previous || !BENGALI_LETTER.test(previous.unicode)) return token;
  return { ...token, unicode: TU_FOLA };
}

/** Pre-base vowel signs are typed inside the cluster and skipped when pairing. */
function isPreBase(token: Token): boolean {
  return token.reorder === "before-consonant";
}

/**
 * Encoding-specific fixups applied after tokenizing and before the engine's
 * generic reorder pass. The generic pass (driven by each rule's `reorder`
 * flag — see `map.ts`) already handles the common pre-base/reph movements;
 * this hook exists for Bijoy-specific exceptions that don't fit that generic
 * model.
 *
 * Four run here. The first two resolve U+2212 as la-fola and U+2018 as ্তু (see
 * `resolveMinusLaFola`, `resolveQuoteTu`). The third promotes a bare hasant to
 * a visible one where the surrounding consonants call for it. Running here
 * rather than on the finished text is what makes it work for "cO&w³" = পঙ্‌ক্তি — the tokens
 * are still in legacy visual order, so the pre-base "w" that splits that
 * cluster is simply skipped over, where a rule matching whole legacy
 * sequences could never match it at all.
 *
 * The fourth collapses a doubled hasant. Bijoy's half-form bytes each
 * carry their own hasant (`š` is ন্, `—` is ্ত — see `map.ts`), so a leading
 * half followed by a trailing one meets in the middle with two: š— would
 * otherwise decode as ন্্ত rather than ন্ত. Bangla never writes two in a row,
 * so dropping the second is unambiguous, and it is what lets the two halves
 * compose for clusters `map.ts` does not happen to enumerate as a pair.
 * The visible hasant is unaffected: it ends in ZWNJ, not in ্.
 */
export function bijoyPostProcess(input: Token[]): Token[] {
  const minusResolved = input.map(resolveMinusLaFola);
  const tokens = minusResolved.map((token, index) => resolveQuoteTu(token, minusResolved[index - 1]));
  const fixed = tokens.map((token, index) => {
    if (token.unicode !== VIRAMA) return token;

    let before = index - 1;
    while (before >= 0 && isPreBase(tokens[before])) before -= 1;
    let after = index + 1;
    while (after < tokens.length && isPreBase(tokens[after])) after += 1;
    if (before < 0 || after >= tokens.length) return token;

    const pair = `${tokens[before].unicode}|${tokens[after].unicode}`;
    return VISIBLE_HASANT_PAIRS.has(pair) ? { ...token, unicode: VISIBLE_VIRAMA } : token;
  });

  return fixed.map((token, index) => {
    if (index === 0 || !token.unicode.startsWith(VIRAMA)) return token;
    if (!fixed[index - 1].unicode.endsWith(VIRAMA)) return token;
    return { ...token, unicode: token.unicode.slice(VIRAMA.length) };
  });
}
