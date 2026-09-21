import type { EncodingDefinition, GlyphRule, Token } from "../encodings/types";

/** Punctuation that means itself in every legacy encoding, when unmapped. */
const SHARED_PUNCTUATION = /[.,;:!?'"()[\]{}\-\u2010-\u2015\u2018\u2019\u201c\u201d\u2026/%]/u;

/**
 * ZWNJ (U+200C) and ZWJ (U+200D): Bengali cluster-shaping joiners that carry
 * meaning in Unicode output but are not legacy bytes in any of these tables.
 *
 * They arrive whenever the input is not purely legacy — text pasted from a
 * document that mixes converted and unconverted runs, or a re-paste of this
 * converter's own output, which emits U+200C itself for the visible hasant
 * (`encodings/bijoy/rules.ts`). Treating them as unrecognized marked the
 * whole conversion invalid over a character that is doing its job, and filed
 * a `failurePatterns` row no mapping rule could ever resolve.
 *
 * Passed through rather than stripped, unlike the BOM in `normalize.ts`. A
 * BOM is always transport noise; these two change how a cluster renders, so
 * removing one would silently alter the user's text — force a ligature that
 * was deliberately broken, or break one that should form.
 */
const BENGALI_JOINERS = /[\u200c\u200d]/u;

/** Rules grouped by first character, each group sorted longest-match-first. */
type RuleIndex = Map<string, GlyphRule[]>;

const indexCache = new WeakMap<EncodingDefinition, RuleIndex>();

function buildIndex(encoding: EncodingDefinition): RuleIndex {
  const cached = indexCache.get(encoding);
  if (cached) return cached;

  const index: RuleIndex = new Map();
  for (const rule of encoding.rules) {
    const key = rule.match[0];
    const bucket = index.get(key) ?? [];
    bucket.push(rule);
    index.set(key, bucket);
  }
  for (const bucket of index.values()) {
    bucket.sort((a, b) => b.match.length - a.match.length);
  }
  indexCache.set(encoding, index);
  return index;
}

/**
 * Scans `text` against `encoding`'s glyph rules using longest-match-first
 * matching (so multi-character legacy sequences win over single-character
 * ones), emitting one Token per match. Unrecognized characters pass through
 * as identity tokens flagged `unmapped: true` — never dropped, never
 * silently mangled.
 */
export function tokenize(text: string, encoding: EncodingDefinition): Token[] {
  const index = buildIndex(encoding);
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const candidates = index.get(text[i]);
    let matched: GlyphRule | undefined;

    if (candidates) {
      for (const rule of candidates) {
        if (text.startsWith(rule.match, i)) {
          matched = rule;
          break;
        }
      }
    }

    if (matched) {
      tokens.push({
        legacy: matched.match,
        unicode: matched.unicode,
        reorder: matched.reorder ?? "none",
        sourceIndex: i,
      });
      i += matched.match.length;
    } else if (
      /\s/u.test(text[i]) ||
      SHARED_PUNCTUATION.test(text[i]) ||
      BENGALI_JOINERS.test(text[i])
    ) {
      // Whitespace, shared punctuation and the Bengali joiners are expected
      // passthrough in every legacy encoding — reporting them as "no mapping
      // rule" buries the characters that genuinely are unmapped. Rules still
      // win first, so an encoding that maps e.g. "|" to । is unaffected.
      tokens.push({ legacy: text[i], unicode: text[i], reorder: "none", sourceIndex: i });
      i += 1;
    } else {
      // Anything else with no rule match is genuinely unrecognized: pass it
      // through unchanged (never drop/mangle it) but flag it for validation.
      tokens.push({ legacy: text[i], unicode: text[i], reorder: "none", unmapped: true, sourceIndex: i });
      i += 1;
    }
  }

  return tokens;
}
