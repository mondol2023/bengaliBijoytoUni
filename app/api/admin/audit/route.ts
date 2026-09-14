import { NextResponse, type NextRequest } from "next/server";
import { requireAdminUser } from "@/lib/auth/session";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { auditLogSchema } from "@/lib/firebase/schemas";
import { logAppError, statusForAppError, toAppError, toSafeResponse } from "@/lib/errors/handlers";
import { AppErrors, type AppError } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 100;

function fail(error: AppError) {
  logAppError(error, { route: "api/admin/audit" });
  return NextResponse.json({ ok: false, error: toSafeResponse(error) }, { status: statusForAppError(error) });
}

/** The most recent admin actions, newest first. Admin-only, per `firestore.rules`. */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  try {
    const snapshot = await getAdminDb().collection("auditLogs").orderBy("createdAt", "desc").limit(RECENT_LIMIT).get();
    const entries = snapshot.docs.flatMap((doc) => {
      const parsed = auditLogSchema.safeParse(doc.data());
      return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
    });
    return NextResponse.json({ ok: true, entries });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load the audit log."));
  }
}
