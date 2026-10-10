import { getEncoding, listEncodings } from "../encodings/registry";
import { tokenize } from "./tokenize";
import type { UnmappedDetail } from "./validate";

/**
 * Diagnoses for failures no mapping rule can fix. Both feed a warning only:
 * they never change converted text, so they need no engine-version bump.
 */

/** Shown when the source is glyph codes, not text. See `looksLikeGlyphOrderText`. */
export const NO_TEXT_MAP_MESSAGE =
  "This text is glyph codes, not letters: the PDF's font has no text map, so no encoding can convert it. Read the pages with the OCR tool instead.";

/** Fewer characters than this is too little to call a page. */
const MIN_GLYPH_ORDER_CHARS = 20;
/** Letters (Latin, Latin-1, Bengali) are scarce in glyph-order text. */
const MAX_GLYPH_ORDER_LETTER_SHARE = 0.2;
/** …and ASCII punctuation is most of it. */
const MIN_GLYPH_ORDER_PUNCT_SHARE = 0.5;
/** Dotted leaders and ruled lines use one or two symbols; a code run uses many. */
const MIN_GLYPH_ORDER_DISTINCT_PUNCT = 6;

const ASCII_PUNCT = /[!-/:-@[-`{-~]/u;
const LETTER = /[A-Za-zÀ-ɏঀ-৿]/u;

/**
 * True for text that is a run of glyph codes. A PDF whose subset font has no
 * `ToUnicode` map makes the extractor return codes in order of first use, so a
 * page comes back as consecutive ASCII punctuation (`! " # $ % ' ( ) * +`) with
 * almost no letters. Legacy Bengali text is the opposite: the consonants live
 * on the Latin letters.
 *
 * Any mapping rule here would be a guess, because the code order differs per
 * document; the right answer is to read the page as an image.
 */
export function looksLikeGlyphOrderText(text: string): boolean {
  let total = 0;
  let letters = 0;
  let punct = 0;
  const distinctPunct = new Set<string>();

  for (const char of text) {
    if (/\s/u.test(char)) continue;
    total += 1;
    if (LETTER.test(char)) letters += 1;
    else if (ASCII_PUNCT.test(char)) {
      punct += 1;
      distinctPunct.add(char);
    }
  }

  return (
    total >= MIN_GLYPH_ORDER_CHARS &&
    letters / total <= MAX_GLYPH_ORDER_LETTER_SHARE &&
    punct / total >= MIN_GLYPH_ORDER_PUNCT_SHARE &&
    distinctPunct.size >= MIN_GLYPH_ORDER_DISTINCT_PUNCT
  );
}

export interface ForeignEncodingHint {
  encodingId: string;
  encodingName: string;
  /** Unmapped occurrences the other encoding maps, and all unmapped occurrences. */
  mappedCount: number;
  totalCount: number;
}

/** A single stray byte is a missing rule; several are a wrong encoding. */
const MIN_FOREIGN_DISTINCT = 3;
const MIN_FOREIGN_SHARE = 0.6;

/**
 * When most unmapped bytes are ones another registered encoding maps, the text
 * was probably converted with the wrong table (or mixes two fonts), and
 * listing dozens of bytes hides that. Returns the best other encoding, or
 * undefined when the evidence is thin: fewer than three distinct bytes, or less
 * than 60% of the occurrences covered. Ties go to the earlier-registered one.
 */
export function findForeignEncoding(
  details: UnmappedDetail[],
  currentEncodingId: string
): ForeignEncodingHint | undefined {
  if (details.length < MIN_FOREIGN_DISTINCT) return undefined;
  const totalCount = details.reduce((sum, d) => sum + d.count, 0);

  let best: ForeignEncodingHint | undefined;
  for (const encoding of listEncodings()) {
    if (encoding.id === currentEncodingId) continue;
    const mappedCount = details
      .filter((d) => tokenize(d.sequence, encoding).every((token) => !token.unmapped))
      .reduce((sum, d) => sum + d.count, 0);
    if (mappedCount / totalCount < MIN_FOREIGN_SHARE) continue;
    if (!best || mappedCount > best.mappedCount) {
      best = { encodingId: encoding.id, encodingName: encoding.name, mappedCount, totalCount };
    }
  }
  return best;
}

export function foreignEncodingMessage(hint: ForeignEncodingHint, currentEncodingId: string): string {
  const current = getEncoding(currentEncodingId)?.name ?? currentEncodingId;
  return (
    `${hint.mappedCount} of the ${hint.totalCount} unmapped characters belong to ${hint.encodingName}, ` +
    `not ${current}. The text may be ${hint.encodingName}, or a document that mixes both fonts.`
  );
}
