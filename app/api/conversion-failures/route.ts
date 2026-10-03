import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { recordConversionFailures } from "@/lib/firebase/conversionFailures";
import { CONVERSION_FAILURE_LIMITS } from "@/lib/conversionFailures/limits";
import { FAILURE_CATEGORIES } from "@/features/converter/engine/classify";
import { checkSharedRateLimit, rateLimitIdentity } from "@/lib/security/sharedRateLimit";
import { readJsonBody } from "@/lib/security/readJsonBody";
import { failResponder, logAppError, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";
import { fileExtensionOnly } from "@/lib/privacy/fileName";
import { resolveAnonymousLabel } from "@/lib/firebase/anonymousVisitors";
import { isAnonymousVisitorId } from "@/lib/conversionFailures/anonymousVisitor";

export const runtime = "nodejs";

// A tighter ceiling than `/api/error-logs`'s 60/5min — still enough for a
// normal session's worth of distinct failures, not enough for a scripted
// flood. Payloads are small now that the privacy bound has landed, so this
// limit is about write volume rather than size.
const RATE_LIMIT = { limit: 30, windowMs: 5 * 60 * 1000 };

const fail = failResponder("api/conversion-failures");

const occurrenceSchema = z.object({
  sessionId: z.string().min(1).max(100),
  source: z.enum(["text", "file", "comparison", "api"]),
  encodingId: z.string().max(64).nullable(),
  engineVersion: z.string().min(1).max(32),
  rulesHash: z.string().max(64).nullable(),
  failureCategory: z.enum(FAILURE_CATEGORIES),
  failedSequence: z.string().min(1).max(CONVERSION_FAILURE_LIMITS.maxFailedSequenceLength),
  position: z.number().int().nonnegative().nullable(),
  contextBefore: z.string().max(CONVERSION_FAILURE_LIMITS.maxContextLength),
  contextAfter: z.string().max(CONVERSION_FAILURE_LIMITS.maxContextLength),
  /**
   * How many occurrences this entry stands for. Optional so a stale tab
   * running the pre-batching bundle still validates, and bounded because it
   * moves an aggregate: the rate limit caps how often a caller can report,
   * this caps how far one report can move a count.
   */
  occurrenceCount: z
    .number()
    .int()
    .min(1)
    .max(CONVERSION_FAILURE_LIMITS.maxOccurrenceCount)
    .optional(),
  // `fullText`/`engineOutput` are no longer collected (privacy bound — see
  // `lib/conversionFailures/occurrence.ts` and
  // `docs/conversion-failure-pipeline.md` §6). They stay in the schema as
  // optional-and-ignored so a stale browser tab running the previous bundle
  // still gets a 200 instead of a validation error, but whatever it sends is
  // dropped here and never reaches Firestore. The `.max()` bound still
  // rejects an abusive payload rather than silently parsing it.
  fullText: z.string().max(CONVERSION_FAILURE_LIMITS.maxContextLength).optional(),
  engineOutput: z.string().max(CONVERSION_FAILURE_LIMITS.maxContextLength).nullable().optional(),
  errorCode: z.string().min(1).max(64),
  errorReason: z.string().min(1).max(CONVERSION_FAILURE_LIMITS.maxErrorReasonLength),
  severity: z.enum(["error", "warning"]),
  /**
   * Accepted but not stored as sent. The current bundle already reduces this
   * to an extension before posting; re-applying the reduction here covers a
   * stale tab running the previous bundle and a caller that is not our
   * client at all. Validation stays permissive (a whole name still parses)
   * so an old tab gets a 200 rather than a rejection.
   */
  fileName: z.string().max(256).nullable().optional(),
  fileType: z.string().max(32).nullable().optional(),
});

const bodySchema = z.object({
  failures: z.array(occurrenceSchema).min(1).max(CONVERSION_FAILURE_LIMITS.maxFailuresPerReport),
  /**
   * A signed-out browser's random id (`lib/conversionFailures/anonymousVisitor.ts`).
   * Deliberately `unknown` here and checked separately: a missing or
   * malformed id costs the report its label, never the report itself.
   */
  anonymousVisitorId: z.unknown().optional(),
});

/**
 * `anonymousN` for a signed-out caller with a valid visitor id, else null.
 * Best-effort like the rest of this route's bookkeeping: a failure to assign
 * a label is logged and the report is recorded unlabelled.
 */
async function anonymousLabelFor(signedIn: boolean, visitorId: unknown): Promise<string | null> {
  if (signedIn || !isAnonymousVisitorId(visitorId)) return null;
  try {
    return await resolveAnonymousLabel(visitorId);
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to assign an anonymous visitor label.", debug: cause },
      { route: "api/conversion-failures" },
    );
    return null;
  }
}

/**
 * Records the distinct-pattern occurrences from one client-side conversion
 * attempt. Deliberately open to anonymous callers, like `/api/error-logs` —
 * `userId` is taken from the verified token when there is one and is null
 * otherwise, never read from the request body. No GET here: these rows are
 * cross-user diagnostic aggregates, so even a signed-in caller cannot read
 * their own back — only `/api/admin/conversion-failures/*` can, matching
 * `firestore.rules`.
 *
 * `GET /api/conversion-failures/known` is not an exception to that. It reads
 * no occurrence row and publishes no stored document: three fields per
 * *pattern* (the short failed sequence, its category, whether it is
 * resolved), which is strictly less than this endpoint already accepts from
 * an anonymous caller.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    // Mirrors `/api/error-logs`: no backend configured, so reporting
    // degrades to "not persisted" rather than failing the conversion.
    return NextResponse.json({ ok: true, persisted: false });
  }

  const user = await getServerUser(request);
  const caller = rateLimitIdentity(request, user);
  const rateLimit = await checkSharedRateLimit({
    key: `conversion-failures:${caller.id}`,
    shared: caller.shared,
    ...RATE_LIMIT,
  });
  if (!rateLimit.ok) return fail(rateLimit.error);

  // Metered rather than `request.json()`: the schema below bounds every
  // field, but only after the whole body has been buffered, and this route
  // takes bodies from anonymous callers. See lib/security/readJsonBody.ts
  // for how the ceiling relates to the largest legitimate report.
  const body = await readJsonBody(request);
  if (!body.ok) return fail(body.error);

  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) {
    return fail(
      AppErrors.validation("Invalid conversion-failure report.", {
        details: { field: parsed.error.issues[0]?.path.join(".") },
      }),
    );
  }

  // Only consulted without a verified user: a signed-in caller is recorded
  // by uid, and a report is never linked across the two.
  const anonymousLabel = await anonymousLabelFor(user !== null, parsed.data.anonymousVisitorId);

  try {
    const ids = await recordConversionFailures(
      parsed.data.failures.map((item) => ({
        userId: user?.uid ?? null,
        anonymousLabel,
        sessionId: item.sessionId,
        source: item.source,
        encodingId: item.encodingId,
        engineVersion: item.engineVersion,
        rulesHash: item.rulesHash,
        failureCategory: item.failureCategory,
        failedSequence: item.failedSequence,
        position: item.position,
        contextBefore: item.contextBefore,
        contextAfter: item.contextAfter,
        occurrenceCount: item.occurrenceCount ?? 1,
        // Deliberately not forwarded — see the schema comment above.
        engineOutput: null,
        errorCode: item.errorCode,
        errorReason: item.errorReason,
        severity: item.severity,
        fileName: fileExtensionOnly(item.fileName),
        fileType: item.fileType ?? null,
        route: null,
      })),
    );
    return NextResponse.json({ ok: true, persisted: true, ids });
  } catch (cause) {
    return fail(toAppError(cause, "Could not record this conversion failure."));
  }
}
