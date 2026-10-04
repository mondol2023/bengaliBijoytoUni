/**
 * Bounds for the AI conversion-resolution pipeline — both what a provider's
 * structured response is allowed to contain (`responseSchema.ts`) and how
 * much context a prompt is allowed to embed (`promptBuilder.ts`). Kept in
 * their own module, apart from the provider adapters, for the same reason as
 * `lib/conversionFailures/limits.ts`: these numbers are useful to more than
 * one file without pulling a server-only adapter into their imports.
 */
export const RESOLUTION_LIMITS = {
  /** A candidate/alternative is a handful of Unicode characters, never a sentence. */
  maxCandidateLength: 64,
  maxAlternatives: 5,
  maxExplanationLength: 500,
  /** Prompt-side context caps — independent of `CONVERSION_FAILURE_LIMITS`, which bounds Firestore storage, not tokens sent to a paid API. */
  maxPromptContextLength: 200,
  maxPromptFullTextLength: 2000,
  /** A provider call that hasn't responded by here is treated as `provider_timeout`. */
  defaultTimeoutMs: 15_000,
  /** `POST /api/admin/conversion-failures/[patternId]/resolve` — bounds real paid-API spend per admin, matching `checkRateLimit`'s fixed-window shape. */
  resolveRateLimit: { limit: 20, windowMs: 10 * 60_000 },
  /** How long an unfinished ("pending") resolution claim blocks a retry before being treated as abandoned — see `lib/ai/resolveConversionFailure.ts`. */
  pendingClaimTimeoutMs: 60_000,
  /** `reviewNote` on `POST /api/admin/conversion-failures/[patternId]/review` — request-body-bounded like `FEEDBACK_LIMITS.maxAdminNoteLength`, not a Firestore schema constraint. */
  maxReviewNoteLength: 500,
  /** Same shape as `resolveRateLimit`, but a review only writes to Firestore (no paid provider call), so a looser per-admin ceiling still blunts scripted abuse. */
  reviewRateLimit: { limit: 60, windowMs: 10 * 60_000 },
} as const;

/** Bounds for whole-document transcription (`lib/ai/transcribeDocument.ts`). */
export const TRANSCRIPTION_LIMITS = {
  /**
   * A long judgment is ~20k words; Bengali costs several tokens a word. The
   * provider cap for the default model is 65,536, so this is that cap — a
   * transcription cut short is flagged `truncated` rather than silently short.
   */
  maxOutputTokens: 65_536,
  /** Inside the route's `maxDuration` (120s), leaving room for extraction and the budget write. */
  timeoutMs: 110_000,
  /** Gemini's inline-data request ceiling is 20MB, and base64 grows a file by a third. */
  maxInlineFileBytes: 14 * 1024 * 1024,
  /** Per caller. A transcription is the most expensive call this app makes, and anonymous visitors can make it. */
  rateLimit: { limit: 5, windowMs: 10 * 60_000 },
} as const;
