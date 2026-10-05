import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdminAuth, getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { requireServerUser } from "@/lib/auth/session";
import { userProfileSchema, type UserProfile } from "@/lib/firebase/schemas";
import { recordUserCreated, recordUserTierChange } from "@/lib/firebase/adminStats";
import { failResponder, logAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";
import { DEFAULT_TIER } from "@/features/usage/tierConfig";

export const runtime = "nodejs";

const tierBodySchema = z.object({ tier: z.enum(["easy", "medium", "pro", "expert", "ultra"]) });

const fail = failResponder("api/users/me");

/**
 * A signed-in user's own account profile — the server-known record that
 * `resolveServerTier` reads instead of trusting a per-request tier value.
 * Reading/writing only ever targets `auth.value.uid`, i.e. exactly the
 * caller's own document; there is no way to address another user's profile
 * through this route.
 */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Accounts aren't set up yet for this deployment."));
  }
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  const snapshot = await getAdminDb().collection("users").doc(auth.value.uid).get();
  if (!snapshot.exists) {
    return NextResponse.json({
      ok: true,
      tier: DEFAULT_TIER,
      email: auth.value.email,
      displayName: null,
      createdAt: null,
      role: auth.value.role,
    });
  }

  const parsed = userProfileSchema.safeParse(snapshot.data());
  if (!parsed.success) {
    return fail(AppErrors.database("Your account profile could not be read.", { debug: parsed.error.issues }));
  }
  return NextResponse.json({ ok: true, ...parsed.data, role: auth.value.role });
}

/** Sets the caller's own account tier — the only field this app currently lets a user self-manage. */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Accounts aren't set up yet for this deployment."));
  }
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(AppErrors.validation("Expected a JSON body."));
  }

  const parsedBody = tierBodySchema.safeParse(json);
  if (!parsedBody.success) {
    return fail(
      AppErrors.validation('Expected { "tier": "easy" | "medium" | "pro" | "expert" | "ultra" }.', { details: { field: "tier" } }),
    );
  }

  const db = getAdminDb();
  const ref = db.collection("users").doc(auth.value.uid);
  const existingSnapshot = await ref.get();
  const existing = existingSnapshot.exists ? userProfileSchema.safeParse(existingSnapshot.data()) : null;

  let displayName: string | null = existing?.success ? existing.data.displayName : null;
  if (!existing?.success) {
    try {
      const authRecord = await getAdminAuth().getUser(auth.value.uid);
      displayName = authRecord.displayName ?? null;
    } catch {
      displayName = null;
    }
  }

  const record: UserProfile = {
    uid: auth.value.uid,
    email: auth.value.email,
    displayName,
    tier: parsedBody.data.tier,
    createdAt: existing?.success ? existing.data.createdAt : new Date().toISOString(),
  };

  await ref.set(record);

  // Best-effort admin counters — see `adminStats.ts`'s module doc for why a
  // failure here is logged and swallowed instead of failing the request.
  try {
    if (existing?.success) {
      await recordUserTierChange(existing.data.tier, record.tier);
    } else {
      await recordUserCreated(record.tier);
    }
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to update admin stats counters.", debug: cause },
      { route: "api/users/me" },
    );
  }

  return NextResponse.json({ ok: true, ...record, role: auth.value.role });
}
