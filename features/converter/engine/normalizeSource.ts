import type { EncodingDefinition } from "../encodings/types";
import { stripBom } from "./normalize";

/**
 * The single source-hygiene pass. Everything that inspects or cleans the
 * *input* before tokenizing happens here, so the text the engine sees, the
 * offsets it reports, and the signals an admin reviews all come from one
 * place instead of being re-derived per call site.
 *
 * Two rules govern what may go in here:
 *
 *  1. **Transform only what cannot be legitimate legacy data.** The BOM
 *     qualifies (`stripBom` — not in CP1252, in zero rules), and so does the
 *     debris of compatibility folding (`restoreFolded`, below). Almost
 *     nothing else does.
 *  2. **Otherwise flag, never change.** These tables address CP1252 bytes,
 *     and several of those bytes are Latin typography characters carrying
 *     real conjuncts. In Bijoy, U+2019 is ্থ, U+00AD is ্ল, U+201C is ু and
 *     U+201D heads the চ্ series. A "smart quotes" or "strip soft hyphens"
 *     cleanup — the kind most text pipelines apply by reflex — would
 *     silently destroy every স্থ and every ল-fola in the document. So they
 *     are reported and passed through untouched.
 */

/**
 * Characters that are ordinary punctuation in Latin text. Whether one is
 * *also* a legacy byte depends on the encoding, so the ambiguous set is
 * intersected with the active rule table rather than hardcoded per encoding.
 */
const LATIN_TYPOGRAPHY = new Set([
  "\u2018", // ' left single quote
  "\u2019", // ' right single quote / apostrophe
  "\u201C", // " left double quote
  "\u201D", // " right double quote
  "\u2013", // – en dash
  "\u2014", // — em dash
  "\u2026", // … ellipsis
  "\u00AD", // soft hyphen
]);

/** The Bengali Unicode block. Legacy CP1252 source text contains none of it. */
const BENGALI_BLOCK = /[\u0980-\u09FF]/u;

export interface SourceSignal {
  /** The ambiguous character, exactly as it appeared. */
  sequence: string;
  count: number;
  /** Offsets into the hygiene-applied text, capped like `UnmappedDetail.positions`. */
  positions: number[];
  /** What this byte converts to under the active table, for the admin's benefit. */
  unicode: string;
  message: string;
}

export interface NormalizedSource {
  /** The text the engine should tokenize. Every offset below indexes into it. */
  text: string;
  signals: SourceSignal[];
}

/** Occurrences recorded per ambiguous character, mirroring `MAX_CONTEXTS`. */
const MAX_POSITIONS = 3;

/**
 * True when the input mixes already-converted Unicode with legacy bytes.
 *
 * This is the only condition under which a Latin-typography byte is
 * genuinely ambiguous. In a pure legacy document U+2019 is unambiguously
 * ্থ — flagging it there would fire on virtually every real document and
 * recreate exactly the noise problem E4 and E6 removed. In mixed content,
 * part of the text has already been through a converter or an editor, so
 * the same byte may be a real apostrophe that a word processor inserted.
 */
function isMixedContent(text: string): boolean {
  return BENGALI_BLOCK.test(text);
}

/**
 * Compatibility folding (NFKC) is applied by Word, by some PDF extractors and
 * by a lot of clipboard paths. It rewrites every legacy byte that has a
 * "compatibility" decomposition, and in Bijoy those are exactly the bytes
 * that carry conjuncts:
 *
 *     ¨ (্য)  -> U+0020 U+0308      ¯ (স্)  -> U+0020 U+0304
 *     ´ (ক্ম) -> U+0020 U+0301      ¸ (গু)  -> U+0020 U+0327
 *     µ (ক্র) -> μ (Greek mu)       ³ (ক্ত) -> 3        … (ৃ) -> ...
 *
 * None of the results is a byte the font could have produced. The engine
 * reported the first group as unmapped, and silently converted the last two to
 * a digit and three dots. The stray space the fold inserts also split a
 * consonant from its vowel sign: "b ̈vqZt" gave "ন ̈ায়তঃ" plus a "vowel sign
 * with no base consonant" defect on top. The table is derived from the
 * encoding's own rules (any single byte it maps that NFKC would change), so a
 * new encoding needs no entry here.
 *
 * Two tiers, by how sure the restoration can be:
 *
 *  - **Certain** (silent): a combining accent, the Greek mu, or a digit right
 *    after a pre-base vowel sign. A vowel sign is always followed by a
 *    consonant, never a numeral, and CP1252 has no combining marks.
 *  - **Guesses** (reported, and only in text that has already shown a certain
 *    sign of folding): a "3" glued to a letter (D3 for D³, উক্ত) and exactly
 *    three dots glued between two letters (K...Z for K…Z, কৃত). Either could
 *    be genuine on its own, so a document with no sign of folding is untouched.
 */
interface FoldTable {
  /** Combining mark -> the legacy byte whose folded form is " " + mark. */
  accents: Map<string, string>;
  /** A folded non-ASCII character -> the legacy byte it came from (μ -> µ). */
  letters: Map<string, string>;
  /** A plain digit -> the superscript byte it came from (3 -> ³). */
  digits: Map<string, string>;
  /** A folded vulgar fraction ("1⁄2") -> the legacy byte it came from (½). */
  fractions: Map<string, string>;
  /** The byte that folds to "...", when the encoding maps one. */
  ellipsis: string | null;
  accentPattern: RegExp | null;
  letterPattern: RegExp | null;
  fractionPattern: RegExp | null;
  afterPreBasePattern: RegExp | null;
  ellipsisPattern: RegExp | null;
  guessedDigitPattern: RegExp | null;
}

/**
 * The one superscript digit restored on a guess. "³" is ক্ত in Bijoy — the
 * commonest conjunct byte in legal text (উক্ত, ব্যক্তি, মুক্ত). "²" is ক্ষ্ম here
 * and ক্ষ্ণ in other tables, so it is restored only where it is certain (after
 * a pre-base vowel), never on a guess.
 */
const GUESSED_DIGIT = "3";

/** U+2044. NFKC puts it inside every folded vulgar fraction ("½" -> "1⁄2"). */
const FRACTION_SLASH = "⁄";

/** A rule that yields only Bengali digits: its byte is a numeral, not a letter. */
const BENGALI_DIGITS = /^[০-৯]+$/u;

const FOLDED_ACCENT =/^ ([̀-ͯ])$/u;

function escapeForClass(chars: Iterable<string>): string {
  return Array.from(chars, (ch) => ch.replace(/[\\\]^-]/g, "\\$&")).join("");
}

/**
 * A map that refuses to answer for a key two different bytes fold to: they
 * cannot be told apart, so neither is restored (the old "unmapped" report is
 * honest; a coin-flip restoration is not).
 */
function conflictFreeMap() {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  return {
    map,
    put(key: string, legacy: string) {
      if (ambiguous.has(key)) return;
      if (map.has(key) && map.get(key) !== legacy) {
        map.delete(key);
        ambiguous.add(key);
        return;
      }
      map.set(key, legacy);
    },
  };
}

function buildFoldTable(encoding: EncodingDefinition): FoldTable {
  const accents = conflictFreeMap();
  const letters = conflictFreeMap();
  const digits = conflictFreeMap();
  const fractions = conflictFreeMap();
  const preBase = new Set<string>();
  // The bytes the encoding turns into Bengali. A guess about a neighbouring
  // character is only sound next to one of these: "Ò" is a Latin-1 letter
  // shape but, in Bijoy, an opening quote, and a numeral after a quote is a
  // numeral ("Ò3 (wZb)" is “৩ (তিন)).
  const bengaliBytes = new Set<string>();
  const matchedChars = new Set<string>();
  let ellipsis: string | null = null;

  for (const rule of encoding.rules) for (const ch of rule.match) matchedChars.add(ch);

  for (const rule of encoding.rules) {
    if (rule.match.length !== 1) continue;
    const legacy = rule.match;
    if (rule.reorder === "before-consonant") preBase.add(legacy);
    if (BENGALI_BLOCK.test(rule.unicode) && !BENGALI_DIGITS.test(rule.unicode)) bengaliBytes.add(legacy);

    const folded = legacy.normalize("NFKC");
    if (folded === legacy) continue;

    const accent = FOLDED_ACCENT.exec(folded);
    if (accent) accents.put(accent[1], legacy);
    else if (/^[0-9]$/.test(folded)) digits.put(folded, legacy);
    else if (folded.includes(FRACTION_SLASH)) fractions.put(folded, legacy);
    else if (folded === "...") ellipsis = legacy;
    else if (
      [...folded].length === 1 &&
      folded.codePointAt(0)! > 0xff &&
      !BENGALI_BLOCK.test(folded) &&
      !matchedChars.has(folded)
    ) {
      letters.put(folded, legacy);
    }
  }

  const guessed = digits.map.has(GUESSED_DIGIT);
  const neighbour = bengaliBytes.size > 0 ? `[${escapeForClass(bengaliBytes)}]` : null;
  return {
    accents: accents.map,
    letters: letters.map,
    digits: digits.map,
    fractions: fractions.map,
    ellipsis,
    accentPattern:
      accents.map.size > 0 ? new RegExp(` ?([${escapeForClass(accents.map.keys())}])`, "gu") : null,
    letterPattern:
      letters.map.size > 0 ? new RegExp(`[${escapeForClass(letters.map.keys())}]`, "gu") : null,
    // Keys are digits around U+2044 only, so they need no regex escaping.
    fractionPattern:
      fractions.map.size > 0 ? new RegExp([...fractions.map.keys()].join("|"), "gu") : null,
    afterPreBasePattern:
      preBase.size > 0 && digits.map.size > 0
        ? new RegExp(`([${escapeForClass(preBase)}])([${escapeForClass(digits.map.keys())}])`, "gu")
        : null,
    ellipsisPattern:
      ellipsis && neighbour ? new RegExp(`(${neighbour})\\.\\.\\.(?=${neighbour})`, "gu") : null,
    guessedDigitPattern:
      guessed && neighbour ? new RegExp(`(${neighbour})${GUESSED_DIGIT}(?![0-9])`, "gu") : null,
  };
}

const foldTables = new WeakMap<EncodingDefinition, FoldTable>();

function foldTableFor(encoding: EncodingDefinition): FoldTable {
  let table = foldTables.get(encoding);
  if (!table) {
    table = buildFoldTable(encoding);
    foldTables.set(encoding, table);
  }
  return table;
}

function unicodeOf(encoding: EncodingDefinition, legacy: string): string {
  return encoding.rules.find((rule) => rule.match === legacy)?.unicode ?? "";
}

function guessSignal(
  shape: string,
  sequence: string,
  unicode: string,
  positions: number[],
): SourceSignal {
  return {
    sequence,
    count: positions.length,
    positions: positions.slice(0, MAX_POSITIONS),
    unicode,
    message:
      `Found ${shape} in text that shows other signs of compatibility folding (a spacing accent, ` +
      `or a Greek μ where ¨ ¯ µ belong), so it was restored to the legacy byte for "${unicode}" ` +
      `${positions.length} time(s). If it was a genuine "${sequence}", retype it.`,
  };
}

/**
 * Undoes compatibility folding on the source, so the tokenizer sees the bytes
 * the font really held. See `FoldTable` for what is restored and why the
 * guesses are gated on evidence.
 */
function restoreFolded(
  text: string,
  encoding: EncodingDefinition,
): { text: string; signals: SourceSignal[] } {
  const table = foldTableFor(encoding);
  let certain = 0;
  let out = text;

  if (table.accentPattern) {
    out = out.replace(table.accentPattern, (match, mark: string, offset: number, whole: string) => {
      // " " + mark is the exact image of the fold. A bare mark is restored
      // only when it is not part of a letter (e + U+0308 is a real ë).
      if (match.length === 1 && offset > 0 && (whole[offset - 1] + mark).normalize("NFC").length === 1) {
        return match;
      }
      certain += 1;
      return table.accents.get(mark)!;
    });
  }

  // Greek mu in a document that also holds Unicode Bengali is just Greek.
  if (table.letterPattern && !isMixedContent(out)) {
    out = out.replace(table.letterPattern, (ch) => {
      certain += 1;
      return table.letters.get(ch)!;
    });
  }

  // A fraction slash is not in CP1252 either, so "1⁄2" can only be a folded "½".
  if (table.fractionPattern && !isMixedContent(out)) {
    out = out.replace(table.fractionPattern, (fraction) => {
      certain += 1;
      return table.fractions.get(fraction)!;
    });
  }

  if (table.afterPreBasePattern) {
    out = out.replace(table.afterPreBasePattern, (_match, vowel: string, digit: string) => {
      certain += 1;
      return vowel + table.digits.get(digit)!;
    });
  }

  if (certain === 0) return { text: out, signals: [] };

  const signals: SourceSignal[] = [];

  if (table.ellipsis && table.ellipsisPattern) {
    const positions: number[] = [];
    out = out.replace(table.ellipsisPattern, (_match, before: string, offset: number) => {
      // Each earlier match shortened the text by two characters.
      positions.push(offset + before.length - positions.length * 2);
      return before + table.ellipsis;
    });
    if (positions.length > 0) {
      signals.push(
        guessSignal(
          "three dots glued between two letters",
          "...",
          unicodeOf(encoding, table.ellipsis),
          positions,
        ),
      );
    }
  }

  const superscript = table.digits.get(GUESSED_DIGIT);
  if (superscript && table.guessedDigitPattern) {
    const positions: number[] = [];
    out = out.replace(table.guessedDigitPattern, (_match, before: string, offset: number) => {
      positions.push(offset + before.length);
      return before + superscript;
    });
    if (positions.length > 0) {
      signals.push(
        guessSignal(
          `a "${GUESSED_DIGIT}" glued to a letter`,
          GUESSED_DIGIT,
          unicodeOf(encoding, superscript),
          positions,
        ),
      );
    }
  }

  return { text: out, signals };
}

export function normalizeSource(text: string, encoding: EncodingDefinition): NormalizedSource {
  const { text: cleaned, signals: restoredSignals } = restoreFolded(stripBom(text), encoding);

  if (!isMixedContent(cleaned)) return { text: cleaned, signals: restoredSignals };

  // Only characters this encoding actually maps are ambiguous; the rest are
  // ordinary punctuation and are already handled as shared passthrough.
  const mapped = new Map<string, string>();
  for (const rule of encoding.rules) {
    if (rule.match.length === 1 && LATIN_TYPOGRAPHY.has(rule.match)) {
      mapped.set(rule.match, rule.unicode);
    }
  }
  if (mapped.size === 0) return { text: cleaned, signals: restoredSignals };

  const positionsBySequence = new Map<string, number[]>();
  for (let i = 0; i < cleaned.length; i += 1) {
    if (!mapped.has(cleaned[i])) continue;
    const seen = positionsBySequence.get(cleaned[i]);
    if (seen) seen.push(i);
    else positionsBySequence.set(cleaned[i], [i]);
  }

  const signals: SourceSignal[] = Array.from(positionsBySequence, ([sequence, positions]) => {
    const unicode = mapped.get(sequence)!;
    return {
      sequence,
      count: positions.length,
      positions: positions.slice(0, MAX_POSITIONS),
      unicode,
      message:
        `"${sequence}" is both Latin punctuation and a legacy byte for "${unicode}" in this encoding. ` +
        `This text mixes Unicode and legacy content, so it was converted as "${unicode}" — ` +
        `check that is what the source meant. Nothing was removed.`,
    };
  });

  signals.sort((a, b) => b.count - a.count);
  return { text: cleaned, signals: [...restoredSignals, ...signals] };
}
