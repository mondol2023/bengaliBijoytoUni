/**
 * Pure helpers behind the landing page's live demo. Everything here runs the
 * real conversion engine — the landing page converts the visitor's own text
 * with exactly the code `/converter` uses, so nothing on the page is a mock
 * of a result the product cannot actually produce.
 */

import { AUTO_DETECT, type EncodingChoice } from "@/features/converter/constants";
import { getEncoding, listEncodings } from "@/features/converter/encodings/registry";
import type { Token } from "@/features/converter/encodings/types";
import { convertLegacyText, detectEncoding } from "@/features/converter/engine/pipeline";
import { tokenize } from "@/features/converter/engine/tokenize";
import { reorderTokens } from "@/features/converter/engine/reorder";
import { assembleText, normalizeText } from "@/features/converter/engine/normalize";
import { validateTokens } from "@/features/converter/engine/validate";
import { SAMPLE_TEXT } from "@/features/converter/sampleText";

/** What the demo shows before the visitor has typed anything of their own. */
export const DEMO_FALLBACK = SAMPLE_TEXT.bijoy;

export interface SpecimenReading {
  /** Encoding actually used for this conversion. */
  encodingId: string;
  encodingName: string;
  /** True when the encoding was guessed rather than chosen by the visitor. */
  detected: boolean;
  /** Detector's share-of-mapped-tokens score for the winning encoding, 0..1. */
  confidence: number;
  unicodeText: string;
  unmappedSequences: string[];
  /** Non-whitespace characters in the source — the same unit the tiers are measured in. */
  charCount: number;
  /** The one word blown up to poster scale, and the legacy bytes it came from. */
  headword: string;
  headwordLegacy: string;
}

function countNonWhitespace(text: string): number {
  return text.replace(/\s/gu, "").length;
}

const BENGALI = /[ঀ-৿]/u;

/**
 * Picks the word to set at display scale: the longest word that actually
 * produced Bengali, so the specimen never blows up a digit run or a
 * sequence the tables could not map.
 */
function pickHeadword(source: string, unicodeText: string): { headword: string; headwordLegacy: string } {
  const legacyWords = source.split(/\s+/u).filter(Boolean);
  const unicodeWords = unicodeText.split(/\s+/u).filter(Boolean);

  let bestIndex = -1;
  for (let i = 0; i < unicodeWords.length; i += 1) {
    const word = unicodeWords[i];
    if (!BENGALI.test(word)) continue;
    if (bestIndex === -1 || word.length > unicodeWords[bestIndex].length) bestIndex = i;
  }
  if (bestIndex === -1) bestIndex = unicodeWords.length > 0 ? 0 : -1;

  return {
    headword: bestIndex === -1 ? "" : unicodeWords[bestIndex],
    headwordLegacy: bestIndex === -1 ? "" : (legacyWords[bestIndex] ?? ""),
  };
}

/** Runs the real pipeline over `source` and packages what the page needs to show. */
export function readSpecimen(source: string, choice: EncodingChoice): SpecimenReading | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  const detection = detectEncoding(source);
  const encodingId =
    choice === AUTO_DETECT ? (detection.encodingId ?? listEncodings()[0]?.id) : choice;
  if (!encodingId) return null;

  const encoding = getEncoding(encodingId);
  const result = convertLegacyText(source, encodingId);
  if (!result.ok || !encoding) return null;

  const scored = detection.scores.find((score) => score.encodingId === encodingId);
  const { headword, headwordLegacy } = pickHeadword(source, result.value.unicodeText);

  return {
    encodingId,
    encodingName: encoding.name,
    detected: choice === AUTO_DETECT,
    confidence: scored?.confidence ?? 0,
    unicodeText: result.value.unicodeText,
    unmappedSequences: result.value.validation.unmappedSequences,
    charCount: countNonWhitespace(source),
    headword,
    headwordLegacy,
  };
}

export type PipelineStageId = "tokenize" | "map" | "reorder" | "assemble" | "validate";

export interface PipelineStage {
  id: PipelineStageId;
  /** Station name, as the engine's own source calls it. */
  label: string;
  /** What this station does, in the product's language. */
  note: string;
  /** Short specimen of this station's output — what it hands the next one. */
  preview: string[];
  /** One-line read-out shown once the station commits. */
  readout: string;
}

function tokenPreview(tokens: Token[], pick: (token: Token) => string, limit = 9): string[] {
  return tokens
    .filter((token) => !/^\s+$/u.test(token.legacy))
    .slice(0, limit)
    .map(pick)
    .map((value) => (value === "" ? "·" : value));
}

/**
 * Re-walks the conversion one station at a time using the engine's own stage
 * functions, so the "how it works" section shows the actual intermediate
 * state rather than a narrated illustration of it.
 */
export function tracePipeline(source: string, encodingId: string): PipelineStage[] {
  const encoding = getEncoding(encodingId);
  if (!encoding || !source.trim()) return [];

  const raw = tokenize(source, encoding);
  const mapped = encoding.postProcess ? encoding.postProcess(raw) : raw;
  const reordered = reorderTokens(mapped);
  const assembled = normalizeText(assembleText(reordered));
  const validation = validateTokens(reordered);

  const moved = reordered.filter((token) => token.reorder !== "none" && token.reorder !== "after-consonant").length;
  const unmapped = raw.filter((token) => token.unmapped && !/^\s+$/u.test(token.legacy)).length;

  return [
    {
      id: "tokenize",
      label: "Tokenize",
      note: "Splits the legacy bytes into the longest sequences the encoding's table recognises.",
      preview: tokenPreview(raw, (token) => token.legacy),
      readout: `${raw.filter((token) => !/^\s+$/u.test(token.legacy)).length} tokens`,
    },
    {
      id: "map",
      label: "Map",
      note: "Swaps each recognised sequence for its Unicode counterpart. Anything with no rule is kept, flagged, and counted.",
      preview: tokenPreview(mapped, (token) => (token.unmapped ? token.legacy : token.unicode)),
      readout: unmapped === 0 ? "all sequences mapped" : `${unmapped} unmapped`,
    },
    {
      id: "reorder",
      label: "Reorder",
      note: "Legacy fonts store vowel signs and reph where they look right, not where they belong. This puts them in logical order.",
      preview: tokenPreview(reordered, (token) => (token.unmapped ? token.legacy : token.unicode)),
      readout: moved === 0 ? "nothing to move" : `${moved} moved`,
    },
    {
      id: "assemble",
      label: "Normalize",
      note: "Joins the stream back into text and normalises it to NFC, the form every modern renderer expects.",
      preview: [assembled.slice(0, 48)],
      readout: `${assembled.length} characters`,
    },
    {
      id: "validate",
      label: "Validate",
      note: "Reports what it could not map instead of silently mangling it. This read-out is the point of the tool.",
      preview: validation.unmappedSequences.length > 0 ? validation.unmappedSequences.slice(0, 9) : ["clean"],
      readout:
        validation.unmappedSequences.length === 0
          ? "no unmapped sequences"
          : `${validation.unmappedSequences.length} sequence${validation.unmappedSequences.length === 1 ? "" : "s"} flagged`,
    },
  ];
}

/**
 * Splits into user-perceived characters. Bengali conjuncts and vowel signs
 * are multi-codepoint, so a naive per-codepoint animation would tear a
 * cluster in half mid-transition.
 */
export function splitGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("bn", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (entry) => entry.segment);
  }
  return Array.from(text);
}
