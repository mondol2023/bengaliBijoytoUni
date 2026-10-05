/**
 * Decides whether a block of text is legacy-encoded Bengali (Bijoy,
 * SutonnyMJ, alpha-ANSI) rather than English or Unicode Bengali — in which
 * case its Latin-looking words are Bengali bytes and must not be spellchecked.
 *
 * `detectEncoding` is the wrong tool here: it scores a legacy-range character
 * match, and reports coverage 1 when there are none, so ordinary English
 * comes back as a confident Bijoy match. What distinguishes legacy text is
 * the density of the Latin-1 / CP1252 characters the encodings borrow for
 * kars and conjuncts (`†`, `‡`, `©`, `¤`, ...), which English essentially
 * never uses in bulk.
 */

/**
 * Characters legacy Bengali fonts lean on that running English (or French,
 * German, Spanish...) essentially never uses. Typographic quotes, dashes,
 * bullets and ellipses are deliberately absent — English has all of them.
 */
const STRONG_MARKERS = /[¡-©¬®¯´¶¸¿†‡ˆ‰‹›˜™ŠŸ]/gu;

/** Any other high character: also what accented English letters are made of, so only meaningful in bulk. */
const HIGH_CHARS = /[\u0080-ÿ†‡ˆ‰‹›˜™ŠŸ]/gu;

const BENGALI_LETTERS = /[ঀ-৿]/gu;

const NON_SPACE = /\S/gu;

const STRONG_RATIO = 0.03;
const STRONG_MIN_COUNT = 3;
const HIGH_RATIO = 0.08;
const HIGH_MIN_COUNT = 3;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

export function looksLikeLegacyText(text: string): boolean {
  const total = count(text, NON_SPACE);
  if (total === 0) return false;

  const high = count(text, HIGH_CHARS);
  if (high < HIGH_MIN_COUNT) return false;

  // Already-Unicode Bengali (alone or mixed with English) is not legacy, even
  // if it happens to carry a few stray symbols.
  if (count(text, BENGALI_LETTERS) >= high) return false;

  const strong = count(text, STRONG_MARKERS);
  if (strong >= STRONG_MIN_COUNT && strong / total >= STRONG_RATIO) return true;
  return high / total >= HIGH_RATIO;
}
