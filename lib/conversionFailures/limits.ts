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
  /** Occurrences accepted in one `/api/conversion-failures` POST — one request per conversion attempt. */
  maxFailuresPerReport: 50,
} as const;
