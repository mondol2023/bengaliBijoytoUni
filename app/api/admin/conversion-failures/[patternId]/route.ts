import { NextResponse, type NextRequest } from "next/server";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { getFailurePatternDetail, listAiResolutionsForPattern } from "@/lib/firebase/conversionFailures";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const fail = failResponder("api/admin/conversion-failures/[patternId]");

/**
 * One failure pattern's full detail — recent occurrences (full text/context
 * included; admin-only, matching `firestore.rules`) plus every AI resolution
 * recorded against it. The single data source for the admin pattern-detail
 * page; no client ever fetches `conversionFailures`/`aiResolutions` directly.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ patternId: string }> }) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const { patternId } = await params;
  if (!patternId) return fail(AppErrors.validation("Missing failure pattern id."));

  try {
    const detail = await getFailurePatternDetail(patternId);
    if (!detail) return fail(AppErrors.notFound(`No failure pattern "${patternId}" was found.`));

    const resolutions = await listAiResolutionsForPattern(patternId);
    return NextResponse.json({
      ok: true,
      pattern: detail.pattern,
      occurrences: detail.occurrences,
      resolutions,
    });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load this failure pattern."));
  }
}
