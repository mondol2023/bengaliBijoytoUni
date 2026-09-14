/**
 * Bounds on the free-text fields of a feedback entry.
 *
 * These live in their own module, apart from the writer in
 * `lib/firebase/feedback.ts`, because the form and the admin triage UI need
 * them too — and that writer imports `firebase-admin`, which must never be
 * pulled into a client bundle. One set of numbers, shared by the `maxLength`
 * on the textarea, the zod body schema on the route, and the truncation in
 * the writer.
 */
export const FEEDBACK_LIMITS = {
  maxMessageLength: 2000,
  maxSampleLength: 500,
  maxAdminNoteLength: 1000,
} as const;
