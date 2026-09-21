import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { requireServerUser } from "@/lib/auth/session";
import { recordComparison } from "@/lib/firebase/recordActivity";
import { comparisonRecordSchema } from "@/lib/firebase/schemas";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 20;

const bodySchema = z.object({
  mode: z.enum(["word", "paragraph"]),
  similarity: z.number().min(0).max(1),
  sourceWordCount: z.number().int().nonnegative(),
  targetWordCount: z.number().int().nonnegative(),
  changedWordCount: z.number().int().nonnegative(),
});

const fail = failResponder("api/comparisons");

/** Explicit "save to history" for the comparison tool — the diff itself is already computed client-side. */
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
      AppErrors.validation("Invalid comparison record.", {
        details: { field: parsedBody.error.issues[0]?.path.join(".") },
      }),
    );
  }

  try {
    const id = await recordComparison({ userId: auth.value.uid, ...parsedBody.data });
    return NextResponse.json({ ok: true, id });
  } catch (cause) {
    return fail(toAppError(cause, "Could not save this comparison to your history."));
  }
}

export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("History isn't set up yet for this deployment."));
  }
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  const snapshot = await getAdminDb()
    .collection("comparisons")
    .where("userId", "==", auth.value.uid)
    .orderBy("createdAt", "desc")
    .limit(RECENT_LIMIT)
    .get();

  const records = snapshot.docs.flatMap((doc) => {
    const parsed = comparisonRecordSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });

  return NextResponse.json({ ok: true, records });
}
