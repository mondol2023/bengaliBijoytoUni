/**
 * Converting a document whose text arrives tagged with the font it was set in.
 *
 * `convertLegacyText` assumes its whole input is in one legacy encoding. A
 * Bangladeshi court judgment is not: its Bengali is legacy bytes in a legacy
 * font, and its quoted orders, citations and party names are English in
 * Times New Roman. Flattening that into one string and converting all of it
 * turned "Call for the records" into "ইতরর পষক্ষ tবন ক্ষনদষক্ষধড়", because the
 * legacy tables map plain ASCII letters too.
 *
 * So each font is classified once, over all the text set in it, and only the
 * fonts that are legacy Bengali go through the engine. Every converted run
 * still goes through `convertLegacyText` itself — there is one conversion code
 * path; this module only decides what to feed it and stitches the results
 * back together with offsets that index the combined source text, so failure
 * capture (`buildFailureOccurrence`) windows the right bytes.
 */
import { AppErrors, err, ok, type AppError, type Result } from "@/lib/errors/types";
import { verdictForFontName } from "../encodings/fontFamilies";
import { getEncoding } from "../encodings/registry";
import { detectEncoding } from "./detectEncoding";
import { normalizeText } from "./normalize";
import type { SourceSignal } from "./normalizeSource";
import { convertLegacyText, type ConversionOutput } from "./pipeline";
import type { OutputSegment } from "./segments";
import type { UnmappedDetail, ValidationResult } from "./validate";
import { CONVERSION_ENGINE_VERSION, computeRulesHash } from "./version";

export interface SourceRun {
  text: string;
  /**
   * A stable per-document key for the font this run was set in. Runs sharing
   * a key are classified together, so the key matters even when the real
   * name could not be resolved.
   */
  fontKey: string;
  /** The font's real name when known (e.g. `ABCDEE+AdarshaLipiNormal`). */
  fontName?: string | null;
}

export type FontDecision =
  | { kind: "legacy"; encodingId: string; reason: FontDecisionReason }
  | { kind: "keep"; reason: FontDecisionReason };

export type FontDecisionReason =
  | "font-name"
  | "already-unicode"
  | "english"
  | "no-legacy-evidence"
  | "detected"
  | "document-fallback"
  | "user-choice"
  | "undetermined";

export interface RunsConversionOutput extends ConversionOutput {
  /** How each font in the document was treated, for diagnostics and the UI. */
  fontDecisions: Array<{ fontKey: string; fontName: string | null; chars: number; decision: FontDecision }>;
  /** Characters converted, by encoding id. */
  convertedChars: Record<string, number>;
  /** Characters passed through unchanged (English, already-Unicode text). */
  keptChars: number;
  /**
   * How well the dominant encoding's table covers the text it converted,
   * 0..1 — the same measure `detectEncoding` reports, taken over the legacy
   * text only, so English in the document no longer drags it down.
   */
  confidence: number;
}

const BENGALI = /[ঀ-৿]/u;
const LETTER = /[A-Za-zÀ-ɏঀ-৿]/u;

/**
 * Function words that make up a large share of any English prose and that no
 * legacy Bengali layout produces as a whole word. Bijoy text is mostly plain
 * ASCII letters, so letter statistics cannot separate it from English; whole
 * stop-words can.
 */
const ENGLISH_STOPWORDS = new Set([
  "the", "of", "and", "to", "in", "is", "was", "that", "for", "on", "by", "with", "as", "be",
  "this", "are", "it", "from", "or", "an", "at", "not", "has", "have", "which", "shall", "been",
  "were", "said", "his", "her", "their", "no", "any", "such", "under", "into", "upon", "court",
]);

/** Share of English stop-words above which a font's text is treated as English. */
const ENGLISH_STOPWORD_RATIO = 0.12;
/** Below this many words the ratio is noise; such fonts fall through to detection. */
const MIN_WORDS_FOR_ENGLISH = 5;

export function englishScore(text: string): { words: number; ratio: number } {
  const words = text
    .split(/[\s.,;:!?()[\]{}"“”‘’/-]+/u)
    .filter((word) => word.length > 0 && LETTER.test(word));
  if (words.length === 0) return { words: 0, ratio: 0 };
  const hits = words.filter((word) => ENGLISH_STOPWORDS.has(word.toLowerCase())).length;
  return { words: words.length, ratio: hits / words.length };
}

function bengaliShare(text: string): number {
  let letters = 0;
  let bengali = 0;
  for (const char of text) {
    if (!LETTER.test(char) && !BENGALI.test(char)) continue;
    letters += 1;
    if (BENGALI.test(char)) bengali += 1;
  }
  return letters === 0 ? 0 : bengali / letters;
}

const isBlank = (text: string) => /^\s*$/u.test(text);

/**
 * The characters a legacy table can actually be built from: CP1252's upper
 * half, i.e. Latin-1 U+00A1–U+00FF plus the 0x80–0x9F specials CP1252 puts
 * elsewhere in Unicode. Arrows, check marks, box drawing and Devanagari
 * danda are none of these, so a symbol font is not mistaken for legacy text.
 */
const CP1252_UPPER = /[\u00a1-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/u;

/**
 * The part of CP1252's upper half English typography uses too. In a legacy
 * font several of these are conjunct bytes (`’` is ্থ in Bijoy), but their
 * presence proves nothing about which script a font holds, so they are not
 * counted as evidence.
 */
const SHARED_TYPOGRAPHY = /[\u00a0\u00ad\u00b0\u00b7\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/u;

/** Source-code punctuation; camelCase identifiers would otherwise read as Bijoy case flips. */
const CODE_PUNCTUATION = /[{}();=<>]/gu;

/**
 * Whether a font's text shows any sign of being legacy Bengali at all.
 *
 * Detection alone cannot answer this: the legacy tables map nearly every
 * ASCII letter, so a party name ("Md. Khairul Alam, J.") or a Latin phrase
 * ("status quo") in an anonymized `CIDFont+F4` scores as fluent Bijoy and
 * comes out as Bengali-looking nonsense. Measured over a 402-PDF corpus of
 * Bangladeshi judgments, real legacy text showed one of two signatures that
 * English lacks:
 *
 * - legacy-range bytes — alpha-ANSI's `¡ ¢ £`, Bijoy's `‡ † ¨ Î`;
 * - Bijoy's mid-word case flips (`wePvicwZ`, `mKj`), produced because its
 *   layout puts different letters on a key's shifted and unshifted slots.
 *   Only trusted over enough words, and never in text that looks like code.
 *
 * A short all-ASCII Bijoy fragment (`Z…Zxq Zdwmj`) has neither and is left
 * alone. That is the intended trade: it stays visible and the user can
 * convert it by choosing an encoding, whereas English converted by mistake
 * is destroyed.
 */
export function hasLegacyEvidence(text: string): boolean {
  let letters = 0;
  let legacyBytes = 0;
  for (const char of text) {
    if (LETTER.test(char)) letters += 1;
    if (CP1252_UPPER.test(char) && !SHARED_TYPOGRAPHY.test(char)) legacyBytes += 1;
  }
  if (legacyBytes >= 2 && legacyBytes >= letters * 0.02) return true;

  const codePunctuation = text.match(CODE_PUNCTUATION)?.length ?? 0;
  if (codePunctuation > text.length * 0.01) return false;
  const words = text.split(/[^A-Za-z]+/u).filter((word) => word.length >= 3);
  if (words.length < 8) return false;
  const flipped = words.filter((word) => /[a-z][A-Z]/u.test(word)).length;
  return flipped / words.length >= 0.3;
}

/**
 * Decides, per font, whether its text is legacy Bengali (and in which
 * encoding) or something to leave alone.
 *
 * Order of evidence: a known font name, then the font's content — already
 * Unicode Bengali, English prose, no legacy signature at all, and finally
 * encoding detection over the font's text. A font with a legacy signature
 * that detection cannot place takes the user's explicit choice, else the
 * document's dominant legacy encoding.
 *
 * The bias is deliberate: text wrongly left alone is still readable and the
 * user can see it, while English wrongly converted is destroyed.
 */
export function classifyFonts(
  runs: readonly SourceRun[],
  options: { encodingOverride?: string } = {},
): Map<string, FontDecision> {
  const byFont = new Map<string, { name: string | null; text: string[] }>();
  for (const run of runs) {
    if (isBlank(run.text)) continue;
    const entry = byFont.get(run.fontKey) ?? { name: run.fontName ?? null, text: [] };
    entry.text.push(run.text);
    byFont.set(run.fontKey, entry);
  }

  const decisions = new Map<string, FontDecision>();
  const undecided: string[] = [];
  const legacyWeight = new Map<string, number>();

  for (const [fontKey, { name, text }] of byFont) {
    const joined = text.join(" ");
    const byName = verdictForFontName(name);

    let decision: FontDecision | undefined;
    if (byName?.kind === "keep") {
      decision = { kind: "keep", reason: "font-name" };
    } else if (bengaliShare(joined) > 0.5) {
      decision = { kind: "keep", reason: "already-unicode" };
    } else if (byName?.kind === "legacy") {
      decision = { kind: "legacy", encodingId: byName.encodingId, reason: "font-name" };
    } else {
      const english = englishScore(joined);
      if (english.words >= MIN_WORDS_FOR_ENGLISH && english.ratio >= ENGLISH_STOPWORD_RATIO) {
        decision = { kind: "keep", reason: "english" };
      } else if (!hasLegacyEvidence(joined)) {
        decision = { kind: "keep", reason: "no-legacy-evidence" };
      } else {
        const detected = detectEncoding(joined);
        if (detected.encodingId) {
          decision = { kind: "legacy", encodingId: detected.encodingId, reason: "detected" };
        }
      }
    }

    if (decision === undefined) {
      undecided.push(fontKey);
      continue;
    }
    if (decision.kind === "legacy") {
      legacyWeight.set(decision.encodingId, (legacyWeight.get(decision.encodingId) ?? 0) + joined.length);
    }
    decisions.set(fontKey, decision);
  }

  const dominant = [...legacyWeight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const fontKey of undecided) {
    if (options.encodingOverride) {
      decisions.set(fontKey, { kind: "legacy", encodingId: options.encodingOverride, reason: "user-choice" });
    } else if (dominant) {
      decisions.set(fontKey, { kind: "legacy", encodingId: dominant, reason: "document-fallback" });
    } else {
      decisions.set(fontKey, { kind: "keep", reason: "undetermined" });
    }
  }

  // An explicit user choice overrides which table legacy text goes through,
  // never whether English or already-Unicode text gets converted.
  if (options.encodingOverride) {
    for (const [fontKey, decision] of decisions) {
      if (decision.kind === "legacy") {
        decisions.set(fontKey, { kind: "legacy", encodingId: options.encodingOverride, reason: "user-choice" });
      }
    }
  }

  return decisions;
}

interface Group {
  key: string; // encoding id, or "" for keep
  text: string;
}

/** Merges adjacent runs with the same treatment; neutral runs join their neighbour. */
function groupRuns(runs: readonly SourceRun[], decisions: Map<string, FontDecision>): Group[] {
  const groups: Group[] = [];
  let pendingNeutral = "";
  for (const run of runs) {
    if (run.text.length === 0) continue;
    // Whitespace carries no evidence and must not split a legacy group: a
    // pre-base kar at the end of one run belongs to the consonant at the
    // start of the next.
    if (isBlank(run.text)) {
      if (groups.length > 0) groups[groups.length - 1].text += run.text;
      else pendingNeutral += run.text;
      continue;
    }
    const decision = decisions.get(run.fontKey)!;
    const key = decision.kind === "legacy" ? decision.encodingId : "";
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.text += run.text;
    } else {
      groups.push({ key, text: pendingNeutral + run.text });
      pendingNeutral = "";
    }
  }
  if (pendingNeutral) groups.push({ key: "", text: pendingNeutral });
  return groups;
}

const MAX_POSITIONS = 3;

function mergeDetails(target: Map<string, UnmappedDetail>, details: UnmappedDetail[], offset: number) {
  for (const detail of details) {
    const shifted = detail.positions.map((position) => position + offset);
    const existing = target.get(detail.sequence);
    if (!existing) {
      target.set(detail.sequence, { ...detail, contexts: [...detail.contexts], positions: shifted });
      continue;
    }
    existing.count += detail.count;
    const room = MAX_POSITIONS - existing.positions.length;
    if (room > 0) {
      existing.contexts.push(...detail.contexts.slice(0, room));
      existing.positions.push(...shifted.slice(0, room));
    }
  }
}

function mergeSignals(target: Map<string, SourceSignal>, signals: SourceSignal[], offset: number) {
  for (const signal of signals) {
    const shifted = signal.positions.map((position) => position + offset);
    const existing = target.get(signal.sequence);
    if (!existing) {
      target.set(signal.sequence, { ...signal, positions: shifted });
      continue;
    }
    existing.count += signal.count;
    existing.positions.push(...shifted.slice(0, Math.max(0, MAX_POSITIONS - existing.positions.length)));
  }
}

/**
 * Converts font-tagged runs: legacy fonts through `convertLegacyText`,
 * everything else passed through (NFC-normalized) untouched.
 *
 * The returned `sourceText` is the concatenation of each group's
 * post-hygiene source, and every `position`/`sourceIndex` is shifted into it.
 * `encodingId`/`rulesHash` describe the encoding that converted the most
 * text; `convertedChars` has the full breakdown.
 *
 * Fails with the same error the single-encoding path gives when there is no
 * legacy text to convert and the user did not choose an encoding.
 */
export function convertRuns(
  runs: readonly SourceRun[],
  options: { encodingOverride?: string } = {},
): Result<RunsConversionOutput, AppError> {
  if (options.encodingOverride && !getEncoding(options.encodingOverride)) {
    return err(
      AppErrors.validation(`Unknown encoding "${options.encodingOverride}".`, { details: { field: "encodingId" } }),
    );
  }

  const decisions = classifyFonts(runs, options);
  const groups = groupRuns(runs, decisions);

  const convertedChars: Record<string, number> = {};
  let keptChars = 0;
  const sourceParts: string[] = [];
  const segments: OutputSegment[] = [];
  const warnings: string[] = [];
  const details = new Map<string, UnmappedDetail>();
  const signals = new Map<string, SourceSignal>();
  let valid = true;
  let offset = 0;

  for (const group of groups) {
    if (group.key === "") {
      sourceParts.push(group.text);
      segments.push({ text: normalizeText(group.text), unmapped: false, sourceIndex: offset });
      keptChars += group.text.length;
      offset += group.text.length;
      continue;
    }

    const converted = convertLegacyText(group.text, group.key);
    if (!converted.ok) return converted;
    const output = converted.value;

    sourceParts.push(output.sourceText);
    for (const segment of output.outputSegments) {
      segments.push({ ...segment, sourceIndex: segment.sourceIndex + offset });
    }
    convertedChars[group.key] = (convertedChars[group.key] ?? 0) + output.sourceText.length;
    valid &&= output.validation.valid;
    for (const warning of output.validation.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    mergeDetails(details, output.validation.unmappedDetails, offset);
    mergeSignals(signals, output.validation.sourceSignals, offset);
    offset += output.sourceText.length;
  }

  const dominant = Object.entries(convertedChars).sort((a, b) => b[1] - a[1])[0]?.[0] ?? options.encodingOverride;
  if (!dominant) {
    return err(
      AppErrors.validation("Could not find any legacy Bengali text in this document to convert.", {
        details: { field: "encodingId" },
      }),
    );
  }

  const legacySource = groups
    .filter((group) => group.key === dominant)
    .map((group) => group.text)
    .join("\n");
  const confidence =
    detectEncoding(legacySource).scores.find((score) => score.encodingId === dominant)?.confidence ?? 0;

  const unmappedDetails = [...details.values()].sort((a, b) => b.count - a.count);
  const validation: ValidationResult = {
    valid,
    warnings,
    unmappedSequences: unmappedDetails.map((detail) => detail.sequence),
    unmappedDetails,
    alreadyUnicode: false,
    sourceSignals: [...signals.values()],
  };

  const fontChars = new Map<string, { name: string | null; chars: number }>();
  for (const run of runs) {
    if (isBlank(run.text)) continue;
    const entry = fontChars.get(run.fontKey) ?? { name: run.fontName ?? null, chars: 0 };
    entry.chars += run.text.length;
    fontChars.set(run.fontKey, entry);
  }

  return ok({
    encodingId: dominant,
    sourceText: sourceParts.join(""),
    // Joined rather than re-normalized: every boundary sits between groups
    // of different scripts (or around whitespace), where NFC composes
    // nothing, and joining keeps `outputSegments` rejoining exactly.
    unicodeText: segments.map((segment) => segment.text).join(""),
    outputSegments: segments,
    validation,
    engineVersion: CONVERSION_ENGINE_VERSION,
    rulesHash: computeRulesHash(getEncoding(dominant)!),
    fontDecisions: [...fontChars.entries()].map(([fontKey, { name, chars }]) => ({
      fontKey,
      fontName: name,
      chars,
      decision: decisions.get(fontKey)!,
    })),
    convertedChars,
    keptChars,
    confidence,
  });
}
