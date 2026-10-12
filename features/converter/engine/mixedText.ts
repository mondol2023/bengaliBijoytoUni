/**
 * Splitting pasted text that mixes two legacy Bengali fonts.
 *
 * A Bangladeshi court judgment is often typed half in Bijoy (the body) and half
 * in the alphabetic ANSI layout (headers, whole pages, now and then a single
 * word dropped into a Bijoy sentence). Pasting it into a text box loses the
 * font names `fontRuns.ts` relies on, and converting the lot with one table
 * garbles whichever font the table is not for: "q¡C−L¡VÑ" through Bijoy comes
 * out as "য়¡ঈ্লখ¡ঠ-", and "Avmvgx †gvt ev‡iK" through alpha-ANSI is no better.
 *
 * The two tables do disagree about a lot of bytes, though. Bijoy owns `† ‡ ˆ …`
 * (its vowel signs and conjuncts) and alpha-ANSI owns `¡ ¢ £ ® ¤ ¥ § Ÿ` (its
 * aa-, i-, ii-, e-, u- and uu-kar), each byte unmapped in the other table. A
 * word carrying one of those is labelled; a word with none (most of both
 * fonts is plain ASCII letters) takes the label of the labelled words around
 * it. The result is a list of `SourceRun`s that `convertRuns` converts one
 * table at a time.
 *
 * This is a heuristic on text that has lost its font information, so it only
 * ever runs when *both* fonts show evidence — text with evidence for one
 * table, or none, is left to the ordinary single-encoding path.
 */
import type { AppError, Result } from "@/lib/errors/types";
import { getEncoding } from "../encodings/registry";
import type { EncodingDefinition } from "../encodings/types";
import { convertRuns, type RunsConversionOutput, type SourceRun } from "./fontRuns";
import { tokenize } from "./tokenize";

/** The two layouts told apart. SutonnyMJ shares Bijoy's bytes and rides along with it. */
const BIJOY = "bijoy";
const ALPHA = "alpha-ansi";

/**
 * Typography both layouts reuse for quotes, dashes and bullets. Several are
 * real conjunct bytes in Bijoy (`”` is চ্চ), but in running text they are as
 * likely English punctuation, so a miss on one is not evidence for either font.
 */
const TYPOGRAPHY = /[ ­–—‘’“”•…]/u;

/**
 * U+2212 is alpha-ANSI's e-kar, but PDF and clipboard paths also hand over
 * Bijoy's la-fola (`Kzwgj−v`) as this character, so it proves nothing.
 */
const AMBIGUOUS_MINUS = "−";

type Label = typeof BIJOY | typeof ALPHA | null;

/**
 * What one table cannot read, i.e. the strongest sign a word belongs to the
 * other. Taken from real tokenizing rather than from a list of bytes: a byte
 * can be missing from one table as a single character and still be used by it
 * inside a longer rule (`š²` is alpha-ANSI's ক্ত, while `š` alone is Bijoy's).
 */
function unreadable(word: string, encoding: EncodingDefinition): number {
  let count = 0;
  for (const token of tokenize(word, encoding)) {
    if (!token.unmapped) continue;
    const char = token.legacy;
    if (char.codePointAt(0)! <= 0x7f || char === AMBIGUOUS_MINUS || TYPOGRAPHY.test(char)) continue;
    count += 1;
  }
  return count;
}

/** Bijoy if alpha-ANSI cannot read the word (and Bijoy can), alpha-ANSI for the reverse, else none. */
function labelWord(word: string, bijoy: EncodingDefinition, alpha: EncodingDefinition): Label {
  const bijoyMisses = unreadable(word, bijoy);
  const alphaMisses = unreadable(word, alpha);
  if (bijoyMisses === alphaMisses) return null;
  return alphaMisses > bijoyMisses ? BIJOY : ALPHA;
}

/** Cost of keeping a word's own font when it contradicts what the word shows. */
const MISMATCH_COST = 2.4;
/** Cost of changing font between two words separated by an ordinary space. */
const SWITCH_COST = 1;
/**
 * Cost of changing font across a line break or a run of spaces. Text that
 * changes font does so at these far more often than between two words of a
 * sentence — a PDF copy leaves a double space where one text run ends — so a
 * word with no evidence of its own at such a seam joins the side that starts
 * after it, not the side that ended before it.
 */
const SEAM_SWITCH_COST = 0.5;
/**
 * Tie-break: a word with no evidence of its own costs a little to sit in a
 * font other than the one most words on its own line show. A switch triggered
 * by one stray word therefore ends right after it instead of carrying on
 * through the plain ASCII words that follow, while a header line keeps its
 * plain words ("J B−cn") with the alpha-ANSI ones beside them.
 */
const OFF_MAJORITY_COST = 0.6;

/**
 * Picks a font for every word at once: each labelled word wants its own label,
 * changing font costs something, and a word with no label of its own simply
 * goes where it is cheapest — normally wherever its neighbours are.
 *
 * The costs are set so that one word contradicting the rest of its line is
 * outvoted (two inline switches plus the off-majority cost, 2.6, against 2.4
 * for overruling the word) while two in a row are not. A lone word is far more
 * likely a byte one table has no rule for — the other table happens to read
 * it — than a change of font, and following it would garble a word that was
 * only missing a mapping.
 */
function resolveLabels(
  labels: readonly Label[],
  switchCosts: readonly number[],
  seams: readonly boolean[],
): Array<typeof BIJOY | typeof ALPHA> {
  const states = [BIJOY, ALPHA] as const;

  // A "line" here is a stretch of words with no seam inside it.
  const lineMajority = new Array<number | null>(labels.length).fill(null);
  for (let start = 0; start < labels.length; ) {
    let end = start + 1;
    while (end < labels.length && !seams[end]) end += 1;
    let balance = 0;
    for (let index = start; index < end; index += 1) {
      if (labels[index] === BIJOY) balance += 1;
      else if (labels[index] === ALPHA) balance -= 1;
    }
    for (let index = start; index < end; index += 1) {
      lineMajority[index] = balance === 0 ? null : balance > 0 ? 0 : 1;
    }
    start = end;
  }

  const cost = (at: number, s: number) => {
    const label = labels[at];
    const mismatch = label !== null && label !== states[s] ? MISMATCH_COST : 0;
    const off = lineMajority[at] !== null && lineMajority[at] !== s ? OFF_MAJORITY_COST : 0;
    return mismatch + off;
  };

  const best: number[][] = [];
  const from: number[][] = [];
  labels.forEach((_, at) => {
    best.push([0, 0]);
    from.push([0, 0]);
    for (let s = 0; s < states.length; s += 1) {
      if (at === 0) {
        best[at][s] = cost(at, s);
        continue;
      }
      let bestPrevious = 0;
      let bestCost = Infinity;
      for (let p = 0; p < states.length; p += 1) {
        const total = best[at - 1][p] + (p === s ? 0 : switchCosts[at]);
        if (total < bestCost) {
          bestCost = total;
          bestPrevious = p;
        }
      }
      best[at][s] = bestCost + cost(at, s);
      from[at][s] = bestPrevious;
    }
  });

  const resolved: Array<typeof BIJOY | typeof ALPHA> = new Array(labels.length);
  let state = best[labels.length - 1][0] <= best[labels.length - 1][1] ? 0 : 1;
  for (let at = labels.length - 1; at >= 0; at -= 1) {
    resolved[at] = states[state];
    state = from[at][state];
  }
  return resolved;
}

/**
 * Cuts `text` into runs by the legacy font each word appears to be set in, or
 * returns null when it does not look like a mix of the two (so the caller
 * converts it as a whole, exactly as before). Run keys are encoding ids and
 * the runs rejoin to `text` exactly.
 */
export function splitMixedLegacy(text: string): SourceRun[] | null {
  const bijoy = getEncoding(BIJOY);
  const alpha = getEncoding(ALPHA);
  if (!bijoy || !alpha) return null;

  const parts = text.split(/(\s+)/u);

  // Even indexes are words (possibly empty at the ends), odd ones whitespace.
  const wordSlots: number[] = [];
  const labels: Label[] = [];
  const switchCosts: number[] = [];
  const seams: boolean[] = [];
  parts.forEach((part, index) => {
    if (index % 2 === 1 || part.length === 0) return;
    const gap = index > 0 ? parts[index - 1] : "";
    const seam = /\n|\s{2,}/u.test(gap);
    seams.push(seam);
    switchCosts.push(seam ? SEAM_SWITCH_COST : SWITCH_COST);
    wordSlots.push(index);
    labels.push(labelWord(part, bijoy, alpha));
  });

  if (!labels.includes(BIJOY) || !labels.includes(ALPHA)) return null;

  const resolved = resolveLabels(labels, switchCosts, seams);
  // Every word outvoted into one font: a single-encoding text with a few gaps.
  if (resolved.every((label) => label === resolved[0])) return null;
  const labelByPart = new Map<number, string>();
  wordSlots.forEach((slot, at) => labelByPart.set(slot, resolved[at]));

  const runs: SourceRun[] = [];
  let currentKey: string = resolved[0];
  parts.forEach((part, index) => {
    if (part.length === 0) return;
    // Whitespace stays with the run it follows, so a run never starts blank.
    const key = labelByPart.get(index) ?? currentKey;
    currentKey = key;
    const last = runs[runs.length - 1];
    if (last && last.fontKey === key) last.text += part;
    else runs.push({ text: part, fontKey: key });
  });
  return runs;
}

/** Maps the run keys `splitMixedLegacy` produces to the encodings they name. */
export const MIXED_RUN_ENCODINGS: Readonly<Record<string, string>> = {
  [BIJOY]: BIJOY,
  [ALPHA]: ALPHA,
};

/**
 * Converts `text` as a mix of the two fonts, or returns null when it is not one
 * (see `splitMixedLegacy`) and the ordinary single-encoding path applies.
 */
export function convertMixedLegacy(text: string): Result<RunsConversionOutput, AppError> | null {
  const runs = splitMixedLegacy(text);
  if (!runs) return null;
  return convertRuns(runs, { knownEncodings: MIXED_RUN_ENCODINGS });
}
