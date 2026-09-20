import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit";
import { reviewConversionResolution, REVIEW_DECISIONS } from "@/lib/ai/reviewConversionResolution";
import { RESOLUTION_LIMITS } from "@/lib/ai/limits";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { logAppError, statusForAppError, toSafeResponse } from "@/lib/errors/handlers";
import { AppErrors, type AppError } from "@/lib/errors/types";

export const runtime = "nodejs";

function fail(error: AppError) {
  logAppError(error, { route: "api/admin/conversion-failures/[patternId]/review" });
  return NextResponse.json({ ok: false, error: toSafeResponse(error) }, { status: statusForAppError(error) });
}

async function auditSafely(input: Parameters<typeof writeAuditLog>[0]) {
  try {
    await writeAuditLog(input);
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to write audit log.", debug: cause },
      { route: "api/admin/conversion-failures/[patternId]/review" },
    );
  }
}

const bodySchema = z.object({
  resolutionId: z.string().min(1),
  decision: z.enum(REVIEW_DECISIONS),
  reviewNote: z.string().max(RESOLUTION_LIMITS.maxReviewNoteLength).nullable().optional(),
});

/**
 * Admin-only: accepts or rejects an existing `aiResolutions` candidate for
 * one `failurePatterns` document. The request body only names *which*
 * resolution and *what* decision — the reviewer identity and timestamp are
 * always derived server-side (`requireAdminUser`), never taken from the
 * client, and every other field on the resolution (`candidateConversion`,
 * `provider`, `model`, ...) is left untouched by this endpoint (see
 * `lib/ai/reviewConversionResolution.ts`).
 *
 * This action only ever writes review metadata onto the `aiResolutions`
 * record — it never modifies `features/converter/engine/**` or any
 * conversion-engine rule, accepted or not.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ patternId: string }> }) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const { patternId } = await params;
  if (!patternId) return fail(AppErrors.validation("Missing failure pattern id."));

  const rate = checkRateLimit({
    key: `ai-review:${auth.value.uid}`,
    limit: RESOLUTION_LIMITS.reviewRateLimit.limit,
    windowMs: RESOLUTION_LIMITS.reviewRateLimit.windowMs,
  });
  if (!rate.ok) return fail(rate.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(AppErrors.validation("Expected a JSON body."));
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      AppErrors.validation("Invalid review request.", { details: { field: parsed.error.issues[0]?.path.join(".") } }),
    );
  }

  const result = await reviewConversionResolution({
    patternId,
    resolutionId: parsed.data.resolutionId,
    decision: parsed.data.decision,
    reviewedBy: auth.value.uid,
    reviewNote: parsed.data.reviewNote,
  });

  if (!result.ok) return fail(result.error);

  await auditSafely({
    actorUid: auth.value.uid,
    action: "conversionFailure.review",
    target: `aiResolutions/${parsed.data.resolutionId}`,
    metadata: {
      patternId,
      decision: parsed.data.decision,
      alreadyReviewed: result.value.alreadyReviewed,
    },
  });

  return NextResponse.json({ ok: true, resolution: result.value.resolution, alreadyReviewed: result.value.alreadyReviewed });
}
