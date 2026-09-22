/**
 * Who decides a failure pattern is "resolved", and on what evidence.
 *
 * ## Not the client, ever
 *
 * `failurePatterns.status` is a published field (`toKnownPattern`). If a
 * caller could set it — by reporting "this converts fine for me now", or
 * through any endpoint that takes a status — an anonymous caller could mark
 * real gaps resolved and empty the admin's work queue. That is the quiet
 * version of the count-poisoning finding in
 * `docs/threat-model-public-failure-endpoints.md` §2: not injecting
 * content, but deleting evidence.
 *
 * Today nothing can: `firestore.rules` denies all client writes to
 * `failurePatterns`, and no route accepts a status. Nothing here adds one.
 *
 * ## The server decides by re-running the engine
 *
 * The input is a sequence the server already stored; the judge is the
 * engine the server is running. `convertLegacyText` is pure and isomorphic,
 * so this is the exact code the browser ran — no second implementation to
 * drift. Nothing about the caller enters the decision.
 *
 * ## Fails closed
 *
 * A pattern with no `encodingId` has no rule table to be judged against, so
 * it is `still_fails` — the same direction `resolutionValidator.ts` takes
 * for an unknown encoding. "We cannot check this" must never read as
 * "this is fine now".
 *
 * ## What it must not do
 *
 * **Delete anything.** A pattern that now converts becomes
 * `status: "resolved"` and keeps its occurrences and its normal retention.
 * Deleting on re-verification would mean a bad engine change could erase
 * the evidence of what it broke. There is no delete in this module and
 * `__tests__/reverify.test.ts` asserts the absence.
 */
import { convertLegacyText } from "@/features/converter/engine/pipeline";
import { CONVERSION_ENGINE_VERSION } from "@/features/converter/engine/version";

export const REVERIFY_VERDICTS = ["still_fails", "converts_now"] as const;
export type ReverifyVerdict = (typeof REVERIFY_VERDICTS)[number];

/** The stored fields the decision reads. A structural subset of `FailurePattern`. */
export interface ReverifiablePattern {
  readonly encodingId: string | null;
  readonly failedSequence: string;
  /** The engine this pattern was recorded under. Metadata to the verdict, trigger to the sweep. */
  readonly engineVersion: string;
}

/**
 * Re-runs the current engine over one stored sequence.
 *
 * `valid` rather than merely `ok`: a conversion that returns output while
 * still reporting unmapped sequences has not converted the thing we asked
 * about.
 */
export function reverifyPattern(pattern: ReverifiablePattern): ReverifyVerdict {
  if (pattern.encodingId === null || pattern.encodingId.length === 0) return "still_fails";
  const result = convertLegacyText(pattern.failedSequence, pattern.encodingId);
  if (!result.ok) return "still_fails";
  return result.value.validation.valid ? "converts_now" : "still_fails";
}

/** The status a verdict implies. The only two values, and neither is a delete. */
export function statusAfterReverify(verdict: ReverifyVerdict): "open" | "resolved" {
  return verdict === "converts_now" ? "resolved" : "open";
}

/**
 * Whether a stored pattern is due a re-verification pass.
 *
 * The engine version differing from the one the pattern was stored under is
 * exactly the condition under which the answer could have changed, and it
 * is how a table fix retires the patterns it fixed instead of leaving them
 * open forever.
 *
 * Deliberately **not** true on every snapshot build. Re-deriving the answer
 * every sixty seconds would work and would bury the signal: the answer only
 * changes when the engine changes, and constant re-derivation makes it
 * impossible to say when it changed or why.
 */
export function needsReverification(
  pattern: ReverifiablePattern,
  currentEngineVersion: string = CONVERSION_ENGINE_VERSION,
): boolean {
  return pattern.engineVersion !== currentEngineVersion;
}

/**
 * The opportunistic check, for the moment a fresh occurrence arrives.
 *
 * Cheap — one pure call on a sequence of at most
 * `maxFailedSequenceLength` characters — and it answers a question the
 * sweep does not: whether a pattern marked resolved was marked too early. A
 * new occurrence against an unchanged engine is evidence it was.
 *
 * Returns the status the pattern should now carry, or `null` when it is
 * already correct and no write is warranted.
 */
export function statusCorrectionOnOccurrence(
  pattern: ReverifiablePattern & { readonly status: "open" | "resolved" },
): "open" | "resolved" | null {
  const next = statusAfterReverify(reverifyPattern(pattern));
  return next === pattern.status ? null : next;
}

/** One stored pattern, as the sweep sees it. */
export interface SweepablePattern extends ReverifiablePattern {
  readonly id: string;
  readonly status: "open" | "resolved";
}

/** One status write the sweep wants applied. There is no delete variant, by design. */
export interface ReverifyStatusChange {
  readonly id: string;
  readonly status: "open" | "resolved";
  readonly verdict: ReverifyVerdict;
}

export interface ReverifySweepPlan {
  readonly examined: number;
  readonly changes: readonly ReverifyStatusChange[];
}

/**
 * The sweep, as a pure function: given the stored patterns, which statuses
 * are now wrong.
 *
 * Planning and applying are separate so the question "what would this
 * change" is answerable without a database, and so the apply step has no
 * judgement in it at all. Patterns whose status already matches the verdict
 * produce no write — a sweep over an unchanged engine costs nothing.
 */
export function planReverifySweep(patterns: readonly SweepablePattern[]): ReverifySweepPlan {
  const changes: ReverifyStatusChange[] = [];
  for (const pattern of patterns) {
    const verdict = reverifyPattern(pattern);
    const status = statusAfterReverify(verdict);
    if (status !== pattern.status) changes.push({ id: pattern.id, status, verdict });
  }
  return { examined: patterns.length, changes };
}
