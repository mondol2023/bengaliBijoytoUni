/**
 * Decides whether a candidate conversion is allowed anywhere near a user.
 *
 * Phase 4 item 4. A pure function: no I/O, no Firebase, no provider import,
 * nothing async. That is deliberate — this is the only thing standing between
 * text a language model wrote and text the product shows as a conversion, so
 * it has to be cheap enough to run twice and exhaustively testable.
 *
 * It runs **before storing** a candidate (`lib/ai/resolveConversionFailure.ts`)
 * and **again before serving** one. Twice, because the two moments ask
 * different questions: the first is "is this worth keeping", the second is
 * "is this still right now" — the rule tables, the engine and the
 * normalization may all have moved since a human accepted it, and an
 * `accepted` flag records a past judgement, not a standing guarantee.
 *
 * Every bound here is read off the live rule tables rather than written down.
 * Hardcoding a list of "legacy-looking characters" would be wrong in this
 * codebase specifically: `’`, `“`, `”` and the soft hyphen are real Bijoy
 * conjunct bytes *and* three of them are legitimate rule outputs, so a
 * hand-written list would either destroy স্থ and ল-fola or wave through
 * unconverted bytes. Deriving both sets from `EncodingDefinition.rules` means
 * the answer stays correct when a table is corrected, and
 * `__tests__/resolutionValidator.test.ts` pins today's derived values so a
 * table change that widens a bound shows up as a failing test rather than as
 * a quietly looser gate.
 */
import { getEncoding } from "@/features/converter/encodings/registry";
import { classifyValidationWarning } from "@/features/converter/engine/classify";
import { validateUnicodeOutput } from "@/features/converter/engine/validate";
import { CONVERSION_FAILURE_LIMITS } from "./limits";

/** The candidate, and the only three things deciding it needs. */
export interface ResolutionCandidate {
  readonly encodingId: string;
  /** The legacy bytes the engine could not convert. */
  readonly failedSequence: string;
  /** The proposed Unicode conversion of exactly that sequence. */
  readonly candidateConversion: string;
}

export const RESOLUTION_REJECTION_CODES = [
  "unknown_encoding",
  "empty_source",
  "empty_candidate",
  "candidate_too_long",
  "not_nfc",
  "control_character",
  "no_target_script",
  "residual_legacy",
  "unexplained_character",
  "dropped_passthrough",
  "length_ratio",
  "stray_vowel_sign",
] as const;

export type ResolutionRejectionCode = (typeof RESOLUTION_REJECTION_CODES)[number];

export interface ResolutionRejection {
  readonly code: ResolutionRejectionCode;
  /** Plain prose, safe to show an admin. Never contains provider output verbatim beyond the offending characters. */
  readonly message: string;
}

export interface ResolutionValidationResult {
  readonly valid: boolean;
  /** Every reason it failed, not just the first — an admin reading a rejection wants the whole picture. */
  readonly rejections: readonly ResolutionRejection[];
}

/** The Bengali Unicode block, as `features/converter/engine/validate.ts` defines it. */
const BENGALI_BLOCK = /[ঀ-৿]/u;

/**
 * Anything in these categories is never legitimate output: C0/C1 controls
 * (except the newline and tab a multi-line source could carry), the
 * replacement character, the BOM, and the bidi overrides — the last because a
 * served resolution is rendered next to text the reader did not write.
 */
const CONTROL_OR_SPOOFING = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F�﻿‪-‮⁦-⁩]/u;

/** Characters that are output in their own right regardless of the table: the joiners and the plain space. */
const ALWAYS_ALLOWED = new Set(["‌", "‍", " ", "\n", "\t"]);

/** What one encoding's rule table says about characters and lengths. */
interface EncodingFacts {
  /** Every character appearing in some rule's `match`. */
  readonly matchChars: ReadonlySet<string>;
  /** Every character appearing in some rule's `unicode`. */
  readonly outputChars: ReadonlySet<string>;
  /**
   * Characters that are only ever legacy input — in a `match` and in no
   * output. Finding one in a candidate means a byte was left unconverted.
   * `’ “ ”` are deliberately *not* in here: they are both, which is what
   * `ambiguous_typography` means.
   */
  readonly legacyOnlyChars: ReadonlySet<string>;
  /** Smallest and largest output/input code-point ratio over all rules, widened to include 1 for passthrough. */
  readonly minRatio: number;
  readonly maxRatio: number;
}

const factsCache = new Map<string, EncodingFacts>();

/**
 * Derives and memoizes one encoding's facts. Pure: rule tables are static
 * module data, so this is a cache of a constant, not state.
 */
export function encodingFactsFor(encodingId: string): EncodingFacts | undefined {
  const cached = factsCache.get(encodingId);
  if (cached) return cached;

  const encoding = getEncoding(encodingId);
  if (!encoding) return undefined;

  const matchChars = new Set<string>();
  const outputChars = new Set<string>();
  let minRatio = 1;
  let maxRatio = 1;

  for (const rule of encoding.rules) {
    const matchLength = [...rule.match].length;
    if (matchLength === 0) continue;
    for (const char of rule.match) matchChars.add(char);
    for (const char of rule.unicode) outputChars.add(char);
    const ratio = [...rule.unicode].length / matchLength;
    if (ratio < minRatio) minRatio = ratio;
    if (ratio > maxRatio) maxRatio = ratio;
  }

  const legacyOnlyChars = new Set<string>();
  for (const char of matchChars) {
    if (!outputChars.has(char)) legacyOnlyChars.add(char);
  }

  const facts: EncodingFacts = { matchChars, outputChars, legacyOnlyChars, minRatio, maxRatio };
  factsCache.set(encodingId, facts);
  return facts;
}

/**
 * The longest candidate worth storing: the longest sequence the API accepts,
 * expanded by the largest expansion any single rule performs. Derived so that
 * raising `maxFailedSequenceLength` cannot silently start truncating real
 * resolutions, and so a provider returning an essay is refused on length
 * alone.
 */
export function maxCandidateLengthFor(encodingId: string): number {
  const facts = encodingFactsFor(encodingId);
  const ratio = facts ? facts.maxRatio : 1;
  return Math.ceil(CONVERSION_FAILURE_LIMITS.maxFailedSequenceLength * ratio);
}

/** Distinct characters of `text`, as code points. */
function charsOf(text: string): string[] {
  return [...text];
}

/**
 * Characters of the source that no rule can match, in order. Conversion has
 * nothing to say about them, so they must survive into the output unchanged —
 * that is what "nothing added or dropped" means for a sequence this short.
 */
function passthroughOf(source: string, facts: EncodingFacts): string[] {
  return charsOf(source).filter((char) => !facts.matchChars.has(char));
}

export function validateCandidateResolution(
  candidate: ResolutionCandidate,
): ResolutionValidationResult {
  const rejections: ResolutionRejection[] = [];
  const add = (code: ResolutionRejectionCode, message: string) => {
    rejections.push({ code, message });
  };

  const facts = encodingFactsFor(candidate.encodingId);
  if (!facts) {
    // Fails closed: an encoding whose table we cannot read is an encoding
    // whose output we cannot check.
    return {
      valid: false,
      rejections: [
        {
          code: "unknown_encoding",
          message: `No rule table is registered for encoding "${candidate.encodingId}".`,
        },
      ],
    };
  }

  const source = candidate.failedSequence;
  const output = candidate.candidateConversion;

  if (source.length === 0) {
    add("empty_source", "There is no failed sequence to convert.");
  }
  if (output.trim().length === 0) {
    add("empty_candidate", "The candidate conversion is empty.");
  }

  const outputChars = charsOf(output);
  const limit = maxCandidateLengthFor(candidate.encodingId);
  if (outputChars.length > limit) {
    add(
      "candidate_too_long",
      `The candidate is ${outputChars.length} characters; the most a conversion of this encoding can produce is ${limit}.`,
    );
  }

  if (CONTROL_OR_SPOOFING.test(output)) {
    add("control_character", "The candidate contains a control, replacement or bidi-override character.");
  }

  // Reuses the engine's own output check rather than restating it, so
  // "valid Unicode Bengali" means the same thing here as it does at the end
  // of a conversion. Its two warnings map onto two rejection codes through
  // the engine's existing classifier.
  for (const warning of validateUnicodeOutput(output).warnings) {
    const category = classifyValidationWarning(warning);
    if (category === "normalization_warning") add("not_nfc", warning);
    else if (category === "reorder_defect") add("stray_vowel_sign", warning);
  }

  if (output.length > 0 && !BENGALI_BLOCK.test(output)) {
    add(
      "no_target_script",
      "The candidate contains no Bengali characters, so it is not a conversion of legacy Bengali text.",
    );
  }

  const residual = new Set<string>();
  const unexplained = new Set<string>();
  const sourceChars = new Set(charsOf(source));
  for (const char of outputChars) {
    if (facts.legacyOnlyChars.has(char)) {
      residual.add(char);
      continue;
    }
    if (BENGALI_BLOCK.test(char)) continue;
    if (facts.outputChars.has(char)) continue;
    if (ALWAYS_ALLOWED.has(char)) continue;
    // Not Bengali, not something any rule can produce, not a joiner — the
    // only remaining way it can be here honestly is that it was in the
    // source and no rule touches it.
    if (sourceChars.has(char)) continue;
    unexplained.add(char);
  }

  if (residual.size > 0) {
    add(
      "residual_legacy",
      `The candidate still contains unconverted legacy characters: ${[...residual].join(" ")}`,
    );
  }
  if (unexplained.size > 0) {
    add(
      "unexplained_character",
      `The candidate contains characters no conversion of this source could produce: ${[...unexplained].join(" ")}`,
    );
  }

  const expected = passthroughOf(source, facts);
  if (expected.length > 0) {
    const kept = new Set(expected);
    const actual = outputChars.filter((char) => kept.has(char));
    if (actual.join("") !== expected.join("")) {
      add(
        "dropped_passthrough",
        `Characters the converter never touches must survive unchanged and in order; expected ${JSON.stringify(expected.join(""))}, found ${JSON.stringify(actual.join(""))}.`,
      );
    }
  }

  if (source.length > 0 && output.length > 0) {
    const ratio = outputChars.length / charsOf(source).length;
    if (ratio < facts.minRatio || ratio > facts.maxRatio) {
      add(
        "length_ratio",
        `The candidate is ${ratio.toFixed(2)}x the length of the source; no run of rules in this encoding produces a ratio outside ${facts.minRatio}–${facts.maxRatio}.`,
      );
    }
  }

  return { valid: rejections.length === 0, rejections };
}

/** The codes, for a caller that wants one line in a log or an audit entry. */
export function summarizeRejections(result: ResolutionValidationResult): string {
  return result.rejections.map((rejection) => rejection.code).join(", ");
}
