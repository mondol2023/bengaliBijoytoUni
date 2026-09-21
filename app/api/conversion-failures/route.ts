import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { recordConversionFailures } from "@/lib/firebase/conversionFailures";
import { CONVERSION_FAILURE_LIMITS } from "@/lib/conversionFailures/limits";
import { FAILURE_CATEGORIES } from "@/features/converter/engine/classify";
import { checkRateLimit, getRequestIp } from "@/lib/security/rateLimit";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

// Heavier payloads than `/api/error-logs` (full source text per occurrence),
// so a tighter ceiling than that route's 60/5min — still enough for a normal
// session's worth of distinct failures, not enough for a scripted flood.
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
  // Capped generously above `maxFullTextLength` here (final truncation with
  // `fullTextTruncated` happens in `recordConversionFailures`) — this bound
  // only exists to stop an outright abusive payload from reaching that far.
  fullText: z.string().max(CONVERSION_FAILURE_LIMITS.maxFullTextLength * 2),
  engineOutput: z.string().max(CONVERSION_FAILURE_LIMITS.maxFullTextLength * 2).nullable(),
  errorCode: z.string().min(1).max(64),
  errorReason: z.string().min(1).max(CONVERSION_FAILURE_LIMITS.maxErrorReasonLength),
  severity: z.enum(["error", "warning"]),
  fileName: z.string().max(256).nullable().optional(),
  fileType: z.string().max(32).nullable().optional(),
});

const bodySchema = z.object({
  failures: z.array(occurrenceSchema).min(1).max(CONVERSION_FAILURE_LIMITS.maxFailuresPerReport),
});

/**
 * Records the distinct-pattern occurrences from one client-side conversion
 * attempt. Deliberately open to anonymous callers, like `/api/error-logs` —
 * `userId` is taken from the verified token when there is one and is null
 * otherwise, never read from the request body. No GET here: unlike
 * `errorLogs`, these rows carry the complete original conversion text, so
 * even a signed-in caller cannot read their own back — only
 * `/api/admin/conversion-failures/*` can, matching `firestore.rules`.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    // Mirrors `/api/error-logs`: no backend configured, so reporting
    // degrades to "not persisted" rather than failing the conversion.
    return NextResponse.json({ ok: true, persisted: false });
  }

  const user = await getServerUser(request);
  const rateLimit = checkRateLimit({
    key: `conversion-failures:${user ? `uid:${user.uid}` : `ip:${getRequestIp(request)}`}`,
    ...RATE_LIMIT,
  });
  if (!rateLimit.ok) return fail(rateLimit.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(AppErrors.validation("Expected a JSON body."));
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      AppErrors.validation("Invalid conversion-failure report.", {
        details: { field: parsed.error.issues[0]?.path.join(".") },
      }),
    );
  }

  try {
    const ids = await recordConversionFailures(
      parsed.data.failures.map((item) => ({
        userId: user?.uid ?? null,
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
        fullText: item.fullText,
        engineOutput: item.engineOutput,
        errorCode: item.errorCode,
        errorReason: item.errorReason,
        severity: item.severity,
        fileName: item.fileName ?? null,
        fileType: item.fileType ?? null,
        route: null,
      })),
    );
    return NextResponse.json({ ok: true, persisted: true, ids });
  } catch (cause) {
    return fail(toAppError(cause, "Could not record this conversion failure."));
  }
}
