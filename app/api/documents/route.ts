import { NextResponse, type NextRequest } from "next/server";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { requireServerUser } from "@/lib/auth/session";
import { documentRecordSchema } from "@/lib/firebase/schemas";
import { logAppError, statusForAppError, toSafeResponse } from "@/lib/errors/handlers";
import { AppErrors, type AppError } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 20;

function fail(error: AppError) {
  logAppError(error, { route: "api/documents" });
  return NextResponse.json({ ok: false, error: toSafeResponse(error) }, { status: statusForAppError(error) });
}

/**
 * Lists the caller's own uploaded-document records (metadata only — never
 * file contents). Records themselves are written by `/api/documents/extract`
 * as a side effect of a signed-in upload; there is no POST here.
 */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("History isn't set up yet for this deployment."));
  }
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  const snapshot = await getAdminDb()
    .collection("documents")
    .where("userId", "==", auth.value.uid)
    .orderBy("createdAt", "desc")
    .limit(RECENT_LIMIT)
    .get();

  const records = snapshot.docs.flatMap((doc) => {
    const parsed = documentRecordSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });

  return NextResponse.json({ ok: true, records });
}
