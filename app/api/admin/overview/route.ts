import { NextResponse, type NextRequest } from "next/server";
import { requireAdminUser } from "@/lib/auth/session";
import { getAdminOverview } from "@/lib/firebase/adminStats";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { logAppError, statusForAppError, toAppError, toSafeResponse } from "@/lib/errors/handlers";
import { AppErrors, type AppError } from "@/lib/errors/types";

export const runtime = "nodejs";

function fail(error: AppError) {
  logAppError(error, { route: "api/admin/overview" });
  return NextResponse.json({ ok: false, error: toSafeResponse(error) }, { status: statusForAppError(error) });
}

/** Site-wide counters + the last 30 days of activity, for the admin overview charts. Admin-only. */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  try {
    const overview = await getAdminOverview();
    return NextResponse.json({ ok: true, ...overview });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load admin stats."));
  }
}
