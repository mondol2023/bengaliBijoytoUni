/**
 * Bounds on `conversionFailures` fields. Live in their own module, apart from
 * the writer in `lib/firebase/conversionFailures.ts`, because the client
 * reporter (browser-bundled) needs these numbers too and that writer imports
 * `firebase-admin`, which must never reach a client bundle. Mirrors
 * `lib/feedback/limits.ts`'s split for the same reason.
 */
export const CONVERSION_FAILURE_LIMITS = {
  /**
   * The widest context window the API will accept either side of a failed
   * sequence. `CONTEXT_WINDOW_CHARS` in `./occurrence.ts` is what reporters
   * actually send and must stay at or under this; `./limits.test.ts` asserts
   * that. Since the privacy bound landed this is also the ceiling on any
   * user-content field in the payload — there is no longer a whole-document
   * field to cap.
   */
  maxContextLength: 200,
  maxFailedSequenceLength: 200,
  maxErrorReasonLength: 500,
  /** Distinct patterns accepted in one `/api/conversion-failures` POST — one request per flushed batch. */
  maxFailuresPerReport: 50,
  /**
   * Ceiling on the `occurrenceCount` delta one batch entry may claim.
   *
   * A batched report tells the server how many times a pattern occurred
   * rather than that it occurred, which means an anonymous caller can now
   * move an aggregate by more than one per request. The rate limit bounds how
   * often; this bounds how far. 1000 is far above any real document's count
   * for a single failed sequence and far below a number that could bury a
   * genuine pattern in the ranking.
   */
  maxOccurrenceCount: 1000,
} as const;
