import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit";
import { reverifyStoredPatterns, REVERIFY_SWEEP_LIMIT } from "@/lib/firebase/reverifyPatterns";
import { CONVERSION_ENGINE_VERSION } from "@/features/converter/engine/version";
import { RESOLUTION_LIMITS } from "@/lib/ai/limits";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { failResponder, logAppError, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const ROUTE = "api/admin/conversion-failures/reverify";
const fail = failResponder(ROUTE);

const bodySchema = z.object({
  encodingId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(REVERIFY_SWEEP_LIMIT).optional(),
});

async function auditSafely(input: Parameters<typeof writeAuditLog>[0]) {
  try {
    await writeAuditLog(input);
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to write audit log.", debug: cause },
      { route: ROUTE },
    );
  }
}

/**
 * Admin-only: re-runs the current engine over a window of stored failure
 * patterns and updates their `status`.
 *
 * This is the engine-change trigger from
 * `docs/phase-5-conversion-with-fallback.md` §3. The request body chooses
 * *which* window to sweep and nothing else — no status, no verdict, no
 * pattern id to mark. The answer comes from
 * `lib/conversionFailures/reverify.ts` re-running `convertLegacyText` over
 * the sequence the server already stored, so a caller cannot retire a real
 * gap by asking.
 *
 * It only ever writes `status`, and never deletes: a bad engine change must
 * not be able to erase the evidence of what it broke.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const rate = checkRateLimit({
    key: `reverify:${auth.value.uid}`,
    limit: RESOLUTION_LIMITS.reviewRateLimit.limit,
    windowMs: RESOLUTION_LIMITS.reviewRateLimit.windowMs,
  });
  if (!rate.ok) return fail(rate.error);

  // An empty body is the whole-window sweep, which is the common case.
  let json: unknown = {};
  try {
    json = await request.json();
  } catch {
    json = {};
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      AppErrors.validation("Invalid re-verification request.", {
        details: { field: parsed.error.issues[0]?.path.join(".") },
      }),
    );
  }

  const { encodingId, limit } = parsed.data;

  try {
    // The encoding is validated inside the sweep, not here: no admin route
    // in this directory may reach the encoding registry
    // (`lib/ai/__tests__/invariants.test.ts`).
    const result = await reverifyStoredPatterns({ encodingId, limit });
    if (!result.ok) return fail(result.error);
    const report = result.value;

    // Audited because it changes what the admin queue shows and what the
    // public snapshot publishes -- who ran it, and what moved.
    await auditSafely({
      actorUid: auth.value.uid,
      action: "conversion_failure_reverify",
      target: encodingId ? `failurePatterns?encodingId=${encodingId}` : "failurePatterns",
      metadata: {
        engineVersion: CONVERSION_ENGINE_VERSION,
        examined: report.examined,
        resolved: report.resolved.length,
        reopened: report.reopened.length,
      },
    });

    return NextResponse.json({ engineVersion: CONVERSION_ENGINE_VERSION, ...report });
  } catch (cause) {
    const error = toAppError(cause, "Could not re-verify the stored failure patterns.");
    logAppError(error, { route: ROUTE });
    return fail(error);
  }
}
