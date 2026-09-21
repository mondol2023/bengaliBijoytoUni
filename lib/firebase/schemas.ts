import { z } from "zod";
import { FAILURE_CATEGORIES } from "@/features/converter/engine/classify";

/**
 * Runtime shapes for every Firestore document this app writes/reads. Nothing
 * crosses the Firestore boundary as a bare `as T` cast — a document written
 * by an older code path, edited by hand in the console, or partially written
 * by a since-changed security rule must fail loudly here rather than crash
 * deep inside a component with a confusing TypeScript-shaped lie.
 *
 * Timestamps are plain ISO strings set with `new Date().toISOString()` by
 * the server route that writes them — not Firestore `Timestamp`/`FieldValue`
 * sentinels. That keeps every schema here pure-`zod` and unit-testable
 * without a Firestore instance, at the cost of losing server-clock-exact
 * ordering guarantees `serverTimestamp()` would give; acceptable for
 * activity records that are only ever displayed, never used to resolve a
 * write conflict.
 */

const tierSchema = z.enum(["easy", "medium", "expert"]);
const fileFormatSchema = z.enum(["pdf", "doc", "docx", "txt"]);

/**
 * A user's own profile. Deliberately holds no role/admin field — role lives
 * only in the Firebase Auth custom claim (see `lib/auth/session.ts`), which
 * only a privileged server path can set. Duplicating it here would create a
 * second, client-writable "source of truth" for authorization.
 */
export const userProfileSchema = z.object({
  uid: z.string().min(1),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  tier: tierSchema,
  createdAt: z.string(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const conversionRecordSchema = z.object({
  userId: z.string().min(1),
  tier: tierSchema,
  encodingId: z.string().min(1),
  inputType: z.enum(["text", "file"]),
  charCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  fileFormat: fileFormatSchema.nullable(),
  durationMs: z.number().nonnegative(),
  status: z.enum(["success", "error"]),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type ConversionRecord = z.infer<typeof conversionRecordSchema>;

export const comparisonRecordSchema = z.object({
  userId: z.string().min(1),
  mode: z.enum(["word", "paragraph"]),
  similarity: z.number().min(0).max(1),
  sourceWordCount: z.number().int().nonnegative(),
  targetWordCount: z.number().int().nonnegative(),
  changedWordCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type ComparisonRecord = z.infer<typeof comparisonRecordSchema>;

export const documentRecordSchema = z.object({
  userId: z.string().min(1),
  storagePath: z.string().min(1),
  fileName: z.string().min(1),
  fileType: fileFormatSchema,
  sizeBytes: z.number().int().nonnegative(),
  extractionStatus: z.enum(["success", "error"]),
  createdAt: z.string(),
});
export type DocumentRecord = z.infer<typeof documentRecordSchema>;

/** Rolling per-user counters — written only by server routes via `FieldValue.increment`. */
export const usageRecordSchema = z.object({
  userId: z.string().min(1),
  totalConversions: z.number().int().nonnegative(),
  totalComparisons: z.number().int().nonnegative(),
  totalDocuments: z.number().int().nonnegative(),
  totalCharsProcessed: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type UsageRecord = z.infer<typeof usageRecordSchema>;

/** Admin-editable defaults layered over `features/usage/tierConfig`'s hard-coded fallback (Phase 7). */
const tierOverrideSchema = z.object({ maxNonWhitespaceChars: z.number().int().positive() }).optional();
export const systemConfigSchema = z.object({
  tierOverrides: z.object({ easy: tierOverrideSchema, medium: tierOverrideSchema, expert: tierOverrideSchema }),
  /** Encoding ids (`listEncodings()`) offered to users; missing/empty means "all registered encodings". */
  enabledEncodings: z.array(z.string()).optional(),
  maxUploadSizeBytes: z.number().int().positive().optional(),
  featureFlags: z
    .object({
      documentsEnabled: z.boolean(),
      comparisonEnabled: z.boolean(),
    })
    .optional(),
  updatedAt: z.string(),
});
export type SystemConfig = z.infer<typeof systemConfigSchema>;

/** A per-user character-limit override, set by an admin — layered on top of (not instead of) the tier's own limit. */
export const usageOverrideSchema = z.object({
  uid: z.string().min(1),
  maxNonWhitespaceChars: z.number().int().positive(),
  updatedAt: z.string(),
  updatedBy: z.string().min(1),
});
export type UsageOverride = z.infer<typeof usageOverrideSchema>;

/** One entry per mutating admin action — who did what to what, never client-writable. */
export const auditLogSchema = z.object({
  actorUid: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/**
 * One row in the failure log — a conversion that errored, a file that could
 * not be extracted, or a run of letters that had no mapping rule. Written
 * only by server routes: the browser reports an issue to
 * `/api/error-logs`, which re-derives `userId` from the verified token and
 * never trusts a client-supplied one.
 *
 * `samples` holds the actual offending legacy sequences (the letters that
 * failed), which is what makes this log usable for fixing mapping tables
 * rather than just counting failures. It is capped at the route boundary —
 * a log row must never become a channel for shipping a whole document into
 * Firestore.
 */
export const errorLogSchema = z.object({
  /** Null for anonymous/unauthenticated reporters — this log deliberately accepts those. */
  userId: z.string().nullable(),
  source: z.enum(["text", "file", "comparison", "api"]),
  kind: z.enum([
    "unmapped_character",
    "conversion_failed",
    "file_extraction_failed",
    "validation_warning",
    "limit_exceeded",
    "rate_limited",
    "unknown",
  ]),
  severity: z.enum(["error", "warning"]),
  /** An `AppErrorCode` where one exists, else a kind-specific constant like `UNMAPPED_CHARACTER`. */
  code: z.string().min(1),
  message: z.string().min(1),
  encodingId: z.string().nullable(),
  fileName: z.string().nullable(),
  fileType: z.string().nullable(),
  /** The legacy sequences that actually failed — empty when the failure wasn't character-level. */
  samples: z.array(z.string()),
  /** Times this identical issue repeated in the reporting session before it was flushed. */
  occurrences: z.number().int().positive(),
  /** Server route that captured it, when server-side; null for browser-reported issues. */
  route: z.string().nullable(),
  createdAt: z.string(),
});
export type ErrorLog = z.infer<typeof errorLogSchema>;

/**
 * A user-submitted review/complaint. Accepted from anonymous visitors too —
 * the people most likely to hit a bad conversion are the ones who never
 * signed up — so `userId` is nullable and `email` is an optional
 * self-reported contact field, not an identity claim (a signed-in
 * submission's email comes from the verified token instead).
 *
 * `status`/`adminNote` are the triage fields; only `/api/admin/feedback`
 * may change them.
 */
export const feedbackSchema = z.object({
  userId: z.string().nullable(),
  /** Verified token email when signed in; otherwise whatever the visitor typed (unverified). */
  email: z.string().nullable(),
  category: z.enum([
    "wrong_conversion",
    "missing_character",
    "file_problem",
    "bug",
    "feature_request",
    "praise",
    "other",
  ]),
  rating: z.number().int().min(1).max(5).nullable(),
  message: z.string().min(1),
  /** Where the complaint came from (`/converter`, `/documents`, ...) — context for triage. */
  page: z.string().nullable(),
  encodingId: z.string().nullable(),
  /** Optional "here is the text that converted wrong" pair, truncated at the route boundary. */
  sampleInput: z.string().nullable(),
  sampleOutput: z.string().nullable(),
  status: z.enum(["new", "reviewed", "resolved"]),
  adminNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

const failureCategorySchema = z.enum(FAILURE_CATEGORIES);

/**
 * One document per individual conversion failure occurrence — never merged,
 * never deduplicated away (that's what `failurePatterns` is for). Deliberately
 * richer than `errorLogSchema` and admin-only-readable (see `firestore.rules`)
 * because it aggregates diagnostic context across users.
 *
 * `failedSequence` and the context window are stored exactly as received —
 * never trimmed, normalized, or replaced — so a persisted row is real
 * evidence a mapping rule can be fixed from, not a lossy summary of one.
 * They are also the *only* user content a row carries; see the privacy bound
 * in `lib/conversionFailures/occurrence.ts`.
 */
export const conversionFailureSchema = z.object({
  userId: z.string().nullable(),
  /** Groups every failure from one conversion attempt without a separate sessions collection. */
  sessionId: z.string().min(1),
  source: z.enum(["text", "file", "comparison", "api"]),
  encodingId: z.string().nullable(),
  engineVersion: z.string().min(1),
  rulesHash: z.string().nullable(),
  failureCategory: failureCategorySchema,
  failedSequence: z.string().min(1),
  codePoints: z.array(z.number().int().nonnegative()),
  position: z.number().int().nonnegative().nullable(),
  contextBefore: z.string(),
  contextAfter: z.string(),
  /**
   * Retained so occurrences written before the privacy bound still parse on
   * read. Always `""`/`false` on documents written since — nothing collects
   * the whole input any more (`lib/conversionFailures/occurrence.ts`).
   */
  fullText: z.string(),
  fullTextTruncated: z.boolean(),
  /** Likewise retained for old documents; always null on new ones. */
  engineOutput: z.string().nullable(),
  errorCode: z.string().min(1),
  errorReason: z.string().min(1),
  severity: z.enum(["error", "warning"]),
  fileName: z.string().nullable(),
  fileType: z.string().nullable(),
  route: z.string().nullable(),
  patternId: z.string().min(1),
  createdAt: z.string(),
});
export type ConversionFailure = z.infer<typeof conversionFailureSchema>;

/**
 * The dedup / cost-control key: one document per distinct
 * `(encodingId, engineVersion, failedSequence)` combination, keyed by a
 * deterministic hash (`lib/conversionFailures/patternId.ts`) so concurrent
 * upserts never race or double-create. AI resolution happens at this level,
 * not per-occurrence — see `aiResolutionSchema`.
 */
export const failurePatternSchema = z.object({
  encodingId: z.string().nullable(),
  engineVersion: z.string().min(1),
  failedSequence: z.string().min(1),
  failureCategory: failureCategorySchema,
  occurrenceCount: z.number().int().positive(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  /** Small capped list of recent `conversionFailures` doc IDs, for admin preview without a second query. */
  sampleOccurrenceIds: z.array(z.string()),
  /** Set to `resolved` only by an explicit admin action once a mapping-rule fix has shipped — never automated. */
  status: z.enum(["open", "resolved"]),
});
export type FailurePattern = z.infer<typeof failurePatternSchema>;

/**
 * A candidate conversion from an external AI provider, keyed to a
 * `failurePatterns` document — never to the original `conversionFailures`
 * row, and never overwriting it. Purely advisory: an admin accepts or
 * rejects it via `reviewDecision`; nothing here ever patches engine rules.
 */
export const aiResolutionSchema = z.object({
  patternId: z.string().min(1),
  provider: z.enum(["gemini", "openai"]),
  model: z.string().min(1),
  /** Bumped whenever the prompt changes; part of the cache key alongside pattern+provider+model. */
  promptVersion: z.string().min(1),
  /**
   * Added in Phase 6 (`lib/ai/resolveConversionFailure.ts`) — the original
   * Phase 4 shape omitted these, but the resolution/dedup design needs them
   * queryable on the doc itself, not just reachable by joining `patternId`
   * back to `failurePatterns` (which doesn't carry `rulesHash` at all — only
   * individual `conversionFailures` occurrences do, and those can drift
   * independently of `engineVersion`). Never client-supplied — always the
   * authoritative value from the `FailurePattern`/occurrence used to build
   * the request.
   */
  engineVersion: z.string().min(1),
  rulesHash: z.string().nullable(),
  /**
   * `null` for a real, meaningful outcome ("the provider found no usable
   * candidate") — not an empty-string stand-in for it. Widened to nullable in
   * Phase 6 to match `ConversionResolution.candidateConversion`
   * (`lib/ai/types.ts`), which is `string | null` for exactly this reason;
   * see `lib/ai/resolveConversionFailure.ts`.
   */
  candidateConversion: z.string().nullable(),
  reasoningSummary: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low", "unknown"]),
  alternativeCandidates: z.array(z.string()),
  isCertain: z.boolean(),
  /** JSON-stringified raw provider response, length-capped, kept for audit only — never trusted directly. */
  rawResponse: z.string().nullable(),
  status: z.enum(["pending", "completed", "failed", "reviewed"]),
  reviewDecision: z.enum(["accepted", "rejected"]).nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
});
export type AiResolution = z.infer<typeof aiResolutionSchema>;

/**
 * Denormalized site-wide counters (`adminStats/totals`), updated with
 * `FieldValue.increment` alongside every activity write — reading this one
 * document is how the admin overview avoids a full collection scan.
 */
export const adminStatsTotalsSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  totalConversions: z.number().int().nonnegative(),
  totalComparisons: z.number().int().nonnegative(),
  totalDocuments: z.number().int().nonnegative(),
  totalCharsProcessed: z.number().int().nonnegative(),
  conversionsByStatus: z.object({
    success: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
  documentsByStatus: z.object({
    success: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
  comparisonsByMode: z.object({
    word: z.number().int().nonnegative(),
    paragraph: z.number().int().nonnegative(),
  }),
  documentsByFormat: z.object({
    pdf: z.number().int().nonnegative(),
    docx: z.number().int().nonnegative(),
    doc: z.number().int().nonnegative(),
    txt: z.number().int().nonnegative(),
  }),
  /** Keyed by encoding id (`"bijoy"`, `"sutonny"`, ...) — open-ended since the registry is extensible. */
  conversionsByEncoding: z.record(z.string(), z.number().int().nonnegative()),
  usersByTier: z.object({
    easy: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    expert: z.number().int().nonnegative(),
  }),
  updatedAt: z.string(),
});
export type AdminStatsTotals = z.infer<typeof adminStatsTotalsSchema>;

/** One document per UTC day (`adminStatsDaily/{yyyy-mm-dd}`) — the source for volume-over-time charts. */
export const adminStatsDailySchema = z.object({
  date: z.string(),
  conversions: z.number().int().nonnegative(),
  comparisons: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
  charsProcessed: z.number().int().nonnegative(),
  conversionErrors: z.number().int().nonnegative(),
  documentErrors: z.number().int().nonnegative(),
});
export type AdminStatsDaily = z.infer<typeof adminStatsDailySchema>;

/**
 * Parses unknown data (a Firestore `DocumentSnapshot.data()` result, or a
 * JSON request body) against one of the schemas above, returning a typed
 * `Result` instead of throwing — the shared error model everything else in
 * the codebase already uses.
 */
export function parseFirestoreDoc<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { ok: true; value: T } | { ok: false; issues: string[] } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
}
