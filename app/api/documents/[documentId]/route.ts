import { NextResponse, type NextRequest } from "next/server";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { deleteDocumentUpload } from "@/lib/firebase/deleteDocumentUpload";
import { requireServerUser } from "@/lib/auth/session";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const fail = failResponder("api/documents/[documentId]");

/**
 * Deletes one of the caller's own uploaded documents — the Storage object and
 * the Firestore record together (`lib/firebase/deleteDocumentUpload.ts` owns
 * the ordering and the partial-failure semantics).
 *
 * Ownership is decided inside the repo function against the record's own
 * `userId`, compared with the uid on the verified bearer token. The path
 * parameter names a document, never a user; there is no request body at all,
 * so there is nothing here for a caller to claim.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("History isn't set up yet for this deployment."));
  }

  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  const { documentId } = await context.params;
  if (!documentId) {
    return fail(AppErrors.validation("Missing a document id.", { details: { field: "documentId" } }));
  }

  try {
    const result = await deleteDocumentUpload({ userId: auth.value.uid, documentId });
    if (!result.ok) return fail(result.error);
    return NextResponse.json({ ok: true, documentId: result.value.documentId });
  } catch (cause) {
    return fail(toAppError(cause, "Could not delete that document."));
  }
}
