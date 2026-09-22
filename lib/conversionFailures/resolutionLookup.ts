/**
 * The lookup key for a stored resolution: `(encodingId, failedSequence)`.
 *
 * Deliberately **not** `patternId`. That id is
 * `sha256("{encodingId}|{engineVersion}|{failedSequence}")`, so it changes
 * whenever the engine version changes — which is right for a *failure*
 * pattern (a failure under engine 2.1 is a different observation from the
 * same failure under 2.0) and wrong for a *resolution*. A human who read a
 * candidate and accepted it accepted a mapping from one legacy sequence to
 * one Unicode string; bumping the engine does not retract that judgement.
 * `engineVersion` therefore rides along as metadata and the validator, not
 * the key, decides whether an older acceptance still holds.
 *
 * The context window is not in the key either. It is 80 characters of one
 * user's surrounding text: matching on it would shrink the store toward
 * one entry per occurrence, and would let one person's neighbouring words
 * decide whether another person gets a result at all.
 *
 * This module is pure and imports nothing from `lib/ai` — the serving side
 * needs the same key as the writing side, and the import boundary asserted
 * by `lib/ai/__tests__/callSites.test.ts` must keep holding.
 */
import { createHash } from "node:crypto";

export interface ResolutionLookupInput {
  /** `null` is a real value — an unidentified encoding — and hashes distinctly from the string "null". */
  readonly encodingId: string | null;
  readonly failedSequence: string;
}

/**
 * A single string suitable for an equality query, rather than a two-field
 * composite index. Both parts are length-prefixed so that
 * `("ab", "c")` and `("a", "bc")` cannot collide — a separator alone would
 * let a sequence containing the separator forge a different pair's key, and
 * `failedSequence` is attacker-influenced (see
 * `docs/threat-model-public-failure-endpoints.md`).
 */
export function computeResolutionLookupKey(input: ResolutionLookupInput): string {
  const encodingId = input.encodingId ?? "";
  const material = `${encodingId.length}:${encodingId}|${input.failedSequence.length}:${input.failedSequence}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}
