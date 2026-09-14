import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { requireServerUser } from "@/lib/auth/session";
import { resolveServerTier } from "@/lib/auth/tier";
import { recordConversion } from "@/lib/firebase/recordActivity";
import { conversionRecordSchema } from "@/lib/firebase/schemas";
import { getEncoding } from "@/features/converter/encodings/registry";
import { logAppError, statusForAppError, toAppError, toSafeResponse } from "@/lib/errors/handlers";
import { AppErrors, type AppError } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 20;

const bodySchema = z.object({
  encodingId: z.string().min(1),
  inputType: z.enum(["text", "file"]),
  charCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  fileFormat: z.enum(["pdf", "doc", "docx", "txt"]).nullable(),
  durationMs: z.number().nonnegative(),
  status: z.enum(["success", "error"]),
  error: z.string().nullable(),
});

function fail(error: AppError) {
  logAppError(error, { route: "api/conversions" });
  return NextResponse.json({ ok: false, error: toSafeResponse(error) }, { status: statusForAppError(error) });
}

/**
 * Explicit "save to history" for the client-side text converter — the
 * converter itself keeps running entirely in the browser (no server round
 * trip for the conversion, unchanged since Phase 2); this only persists the
 * record afterward, at the user's request. Tier on the saved record is
 * always the caller's server-known tier, never a value from the request
 * body — the same rule `/api/documents/extract` follows.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("History isn't set up yet for this deployment."));
  }
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(AppErrors.validation("Expected a JSON body."));
  }

  const parsedBody = bodySchema.safeParse(json);
  if (!parsedBody.success) {
    return fail(
      AppErrors.validation("Invalid conversion record.", {
        details: { field: parsedBody.error.issues[0]?.path.join(".") },
      }),
    );
  }

  // `encodingId` is otherwise just an opaque client-supplied string, and it
  // flows straight into a Firestore field path in the admin stats aggregate
  // (`conversionsByEncoding.<id>`, see `recordConversionStats`) — an
  // unvalidated value would let any signed-in caller write arbitrary field
  // names into that shared document. Constraining it to an actually
  // registered encoding id closes that off.
  if (!getEncoding(parsedBody.data.encodingId)) {
    return fail(
      AppErrors.validation("Unknown encoding id.", { details: { field: "encodingId" } }),
    );
  }

  const tier = await resolveServerTier(auth.value.uid);

  try {
    const id = await recordConversion({ userId: auth.value.uid, tier, ...parsedBody.data });
    return NextResponse.json({ ok: true, id });
  } catch (cause) {
    return fail(toAppError(cause, "Could not save this conversion to your history."));
  }
}

/** Returns the caller's own most recent conversions — never another user's. */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("History isn't set up yet for this deployment."));
  }
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  const snapshot = await getAdminDb()
    .collection("conversions")
    .where("userId", "==", auth.value.uid)
    .orderBy("createdAt", "desc")
    .limit(RECENT_LIMIT)
    .get();

  const records = snapshot.docs.flatMap((doc) => {
    const parsed = conversionRecordSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });

  return NextResponse.json({ ok: true, records });
}
