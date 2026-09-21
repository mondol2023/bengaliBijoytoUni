import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit";
import { resolveConversionFailure } from "@/lib/ai/resolveConversionFailure";
import { SUPPORTED_PROVIDER_IDS } from "@/lib/ai/types";
import { RESOLUTION_LIMITS } from "@/lib/ai/limits";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { failResponder, logAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const fail = failResponder("api/admin/conversion-failures/[patternId]/resolve");

async function auditSafely(input: Parameters<typeof writeAuditLog>[0]) {
  try {
    await writeAuditLog(input);
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to write audit log.", debug: cause },
      { route: "api/admin/conversion-failures/[patternId]/resolve" },
    );
  }
}

const bodySchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDER_IDS),
  includeContext: z.boolean().optional(),
  includeFullText: z.boolean().optional(),
});

/**
 * Admin-only: triggers (or reuses) an AI resolution candidate for one
 * `failurePatterns` document. The request body only names *which* pattern
 * and provider — every field that ends up in the AI prompt or the persisted
 * `aiResolutions` record is loaded server-side from Firestore, never taken
 * from the client (see `lib/ai/resolveConversionFailure.ts`).
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
    key: `ai-resolve:${auth.value.uid}`,
    limit: RESOLUTION_LIMITS.resolveRateLimit.limit,
    windowMs: RESOLUTION_LIMITS.resolveRateLimit.windowMs,
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
      AppErrors.validation("Invalid resolution request.", { details: { field: parsed.error.issues[0]?.path.join(".") } }),
    );
  }

  const result = await resolveConversionFailure({
    patternId,
    providerId: parsed.data.provider,
    includeContext: parsed.data.includeContext ?? false,
    includeFullText: parsed.data.includeFullText ?? false,
  });

  if (!result.ok) return fail(result.error);

  await auditSafely({
    actorUid: auth.value.uid,
    action: "conversionFailure.resolve",
    target: `failurePatterns/${patternId}`,
    metadata: { provider: parsed.data.provider, reused: result.value.reused, status: result.value.resolution.status },
  });

  return NextResponse.json({ ok: true, resolution: result.value.resolution, reused: result.value.reused });
}
