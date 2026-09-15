import type { Token } from "../encodings/types";

/** A token made up only of dependent marks (kar, chandrabindu, anusvara, visarga). */
const MARK_ONLY = /^[া-ৌৗঁ-ঃ]+$/u;

/** A standalone hasant token, i.e. the joiner inside a spelled-out conjunct. */
const VIRAMA_ONLY = /^্+$/u;

/**
 * A token that continues the consonant cluster it follows rather than
 * starting a new one: a fola / hasant-joined half such as ্র, ্য, ্ল, ্প.
 * These are typed after their base consonant in legacy text *and* stored
 * after it in Unicode, so they need no reordering of their own — but a
 * pre-base vowel sign has to be held until they are all emitted.
 */
const CLUSTER_CONTINUATION = /^্/u;

/**
 * Finds where a reph belongs: immediately before the consonant cluster that
 * precedes it. Legacy text types the reph last, after that cluster has
 * already picked up its own vowel sign(s), so we skip back over any trailing
 * marks, then over the cluster itself — including hasant-joined halves, so
 * "ক ্ ত ©" lands as র্ক্ত rather than ক্র্ত.
 *
 * Folas carried on a single token (Bijoy's "¨" => ্য, "Ö" => ্র, "ø" => ্ল)
 * are part of that cluster too, and are skipped by the same logic: "K¨©"
 * has to land as র্ক্য, not কর্্য. They are matched by
 * `CLUSTER_CONTINUATION` but not by `VIRAMA_ONLY`, which covers only a bare
 * hasant standing between two separately-tokenized consonants.
 */
function rephInsertIndex(output: Token[]): number {
  let at = output.length;
  while (at > 0 && MARK_ONLY.test(output[at - 1].unicode)) at -= 1;
  while (
    at > 0 &&
    CLUSTER_CONTINUATION.test(output[at - 1].unicode) &&
    !VIRAMA_ONLY.test(output[at - 1].unicode)
  ) {
    at -= 1;
  }
  if (at > 0) at -= 1;
  while (at > 0 && VIRAMA_ONLY.test(output[at - 1].unicode)) at -= 2;
  return Math.max(at, 0);
}

/**
 * Reassembles tokens from legacy visual order into Unicode logical order.
 *
 * Legacy Bengali ASCII fonts are visual-order: glyphs are typed in the order
 * they are drawn on screen, not the order Unicode requires them stored in.
 * Two categories need repositioning (see `encodings/types.ts` `ReorderKind`):
 *
 *  - `before-consonant`: a pre-base vowel sign (ি, ে, ৈ, ো, ৌ) is typed
 *    BEFORE the consonant it visually precedes, but Unicode requires it
 *    stored AFTER that consonant — and after the whole cluster that
 *    consonant heads, not just its first token. We buffer it and re-emit it
 *    once the next pushed token and any cluster continuation following it
 *    (a fola like ্র/্য/্ল, or a spelled-out hasant + consonant pair) are
 *    all out, so "‡kÖwY" lands as শ্রেণি rather than শে্রণি.
 *  - `reph`: typed AFTER the consonant cluster it visually sits above, but
 *    Unicode requires it stored BEFORE that cluster — see `rephInsertIndex`.
 *
 * This is a general, best-effort rule — not a full Bengali shaping engine.
 * Real cases that this gets wrong should become fixtures, then rules, not
 * silent patches.
 */
export function reorderTokens(tokens: Token[]): Token[] {
  const output: Token[] = [];
  let pendingBeforeConsonant: Token[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.reorder === "before-consonant") {
      pendingBeforeConsonant.push(token);
      continue;
    }

    if (token.reorder === "reph") {
      output.splice(rephInsertIndex(output), 0, token);
      continue;
    }

    output.push(token);
    if (pendingBeforeConsonant.length === 0) continue;

    // The vowel sign attaches to the cluster, not to its first consonant, so
    // emit any continuation tokens before releasing it. A standalone hasant
    // takes the consonant after it along too ("ি ক ্ ত" -> ক্তি), mirroring
    // how `rephInsertIndex` skips back over the same pairs.
    let next = i + 1;
    while (next < tokens.length && CLUSTER_CONTINUATION.test(tokens[next].unicode)) {
      if (VIRAMA_ONLY.test(tokens[next].unicode)) {
        if (next + 1 >= tokens.length) break;
        output.push(tokens[next], tokens[next + 1]);
        next += 2;
        continue;
      }
      output.push(tokens[next]);
      next += 1;
    }
    i = next - 1;

    output.push(...pendingBeforeConsonant);
    pendingBeforeConsonant = [];
  }

  // Any pre-base vowel signs left pending (e.g. truncated/malformed input
  // with nothing following them) are appended rather than dropped — the
  // engine never silently discards input.
  if (pendingBeforeConsonant.length > 0) {
    output.push(...pendingBeforeConsonant);
  }

  return output;
}
