import { NextResponse, type NextRequest } from "next/server";
import type { UserRecord } from "firebase-admin/auth";
import { requireAdminUser } from "@/lib/auth/session";
import { getAdminAuth, getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { userProfileSchema, usageOverrideSchema } from "@/lib/firebase/schemas";
import { DEFAULT_TIER } from "@/features/usage/tierConfig";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";
import type { TierId } from "@/types/domain";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

const fail = failResponder("api/admin/users");

export interface AdminUserRow {
  uid: string;
  email: string | null;
  displayName: string | null;
  tier: TierId;
  disabled: boolean;
  isAdmin: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  usageOverrideMaxChars: number | null;
}

/**
 * Lists Firebase Auth users, joined with each one's `users/{uid}` Firestore
 * profile for tier/displayName. Two search modes, both bounded (never a full
 * scan): no `email`/`pageToken` browses the Auth user list a page (50) at a
 * time; `?email=` does an O(1) exact-match lookup via `getUserByEmail` — the
 * Admin SDK has no substring/fuzzy search, so that's the honest limit of
 * "search" here without standing up a separate search index.
 */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim();
  const pageToken = searchParams.get("pageToken") ?? undefined;

  try {
    const adminAuth = getAdminAuth();

    if (email) {
      try {
        const record = await adminAuth.getUserByEmail(email);
        const row = await joinProfile(record);
        return NextResponse.json({ ok: true, users: [row], nextPageToken: null });
      } catch {
        return NextResponse.json({ ok: true, users: [], nextPageToken: null });
      }
    }

    const page = await adminAuth.listUsers(PAGE_SIZE, pageToken);
    const users = await Promise.all(page.users.map(joinProfile));
    return NextResponse.json({ ok: true, users, nextPageToken: page.pageToken ?? null });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load users."));
  }
}

async function joinProfile(record: UserRecord): Promise<AdminUserRow> {
  const db = getAdminDb();
  const [snapshot, overrideSnapshot] = await Promise.all([
    db.collection("users").doc(record.uid).get(),
    db.collection("usageOverrides").doc(record.uid).get(),
  ]);
  const parsed = snapshot.exists ? userProfileSchema.safeParse(snapshot.data()) : null;
  const overrideParsed = overrideSnapshot.exists ? usageOverrideSchema.safeParse(overrideSnapshot.data()) : null;

  return {
    uid: record.uid,
    email: record.email ?? null,
    displayName: (parsed?.success ? parsed.data.displayName : record.displayName) ?? null,
    tier: parsed?.success ? parsed.data.tier : DEFAULT_TIER,
    disabled: record.disabled,
    isAdmin: record.customClaims?.admin === true,
    createdAt: record.metadata.creationTime ?? null,
    lastSignInAt: record.metadata.lastSignInTime ?? null,
    usageOverrideMaxChars: overrideParsed?.success ? overrideParsed.data.maxNonWhitespaceChars : null,
  };
}
