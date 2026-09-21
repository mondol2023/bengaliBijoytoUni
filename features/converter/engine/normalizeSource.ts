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
 *     qualifies (`stripBom` — not in CP1252, in zero rules). Almost nothing
 *     else does.
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

export function normalizeSource(text: string, encoding: EncodingDefinition): NormalizedSource {
  const cleaned = stripBom(text);

  if (!isMixedContent(cleaned)) return { text: cleaned, signals: [] };

  // Only characters this encoding actually maps are ambiguous; the rest are
  // ordinary punctuation and are already handled as shared passthrough.
  const mapped = new Map<string, string>();
  for (const rule of encoding.rules) {
    if (rule.match.length === 1 && LATIN_TYPOGRAPHY.has(rule.match)) {
      mapped.set(rule.match, rule.unicode);
    }
  }
  if (mapped.size === 0) return { text: cleaned, signals: [] };

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
  return { text: cleaned, signals };
}
