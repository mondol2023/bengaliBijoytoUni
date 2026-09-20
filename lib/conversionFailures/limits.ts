/**
 * Bounds on `conversionFailures` fields. Live in their own module, apart from
 * the writer in `lib/firebase/conversionFailures.ts`, because the client
 * reporter (browser-bundled) needs these numbers too and that writer imports
 * `firebase-admin`, which must never reach a client bundle. Mirrors
 * `lib/feedback/limits.ts`'s split for the same reason.
 */
export const CONVERSION_FAILURE_LIMITS = {
  /** Firestore caps a document at 1 MiB; this leaves headroom for the rest of the fields. */
  maxFullTextLength: 200_000,
  maxContextLength: 200,
  maxFailedSequenceLength: 200,
  maxErrorReasonLength: 500,
  /** Occurrences accepted in one `/api/conversion-failures` POST — one request per conversion attempt. */
  maxFailuresPerReport: 50,
} as const;
