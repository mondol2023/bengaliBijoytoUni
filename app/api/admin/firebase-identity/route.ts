import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdminUser } from "@/lib/auth/session";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";
import { getAdminDb, getAdminFirebaseIdentity, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import {
  PRODUCTION_FIREBASE_PROJECT_ID,
  STAGING_REFUSAL_MESSAGE,
  checkStagingTarget,
} from "@/lib/firebase/projectGuard";

export const runtime = "nodejs";

const fail = failResponder("api/admin/firebase-identity");

const PROBE_COLLECTION = "stagingProbes";
const PROBE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Runtime half of the release gate (docs/release-record-phase9.md, checks 2
 * and 4; docs/staging-environment.md §8). Admin-only: ordinary visitors get
 * nothing here.
 *
 * GET reports which Firebase project this running deployment is actually
 * configured for, as project ids only. The service account is reduced to the
 * project its email names; no key, no email, no other config is returned.
 */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const admin = getAdminFirebaseIdentity();
  return NextResponse.json({
    ok: true,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    clientProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null,
    adminProjectId: admin.projectId,
    serviceAccountProjectId: admin.serviceAccountProjectId,
    emulated: admin.emulated,
    targetsProduction:
      admin.projectId === PRODUCTION_FIREBASE_PROJECT_ID ||
      admin.serviceAccountProjectId === PRODUCTION_FIREBASE_PROJECT_ID,
  });
}

/**
 * The controlled Firestore operation: one synthetic `stagingProbes` document
 * written and read back. **Refused on Production** — whatever the deployment
 * calls itself — so this route can never be the thing that writes a test row
 * to `legacy2uni`. The probe holds no user content and expires after a day
 * once the staging TTL policy on `stagingProbes` is active.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const admin = getAdminFirebaseIdentity();
  const target = checkStagingTarget(admin.projectId);
  if (!target.ok || admin.serviceAccountProjectId === PRODUCTION_FIREBASE_PROJECT_ID) {
    return fail(
      AppErrors.authorization(target.ok ? STAGING_REFUSAL_MESSAGE : target.message),
    );
  }

  const id = `probe-${randomUUID()}`;
  const now = new Date();
  const data = {
    marker: "staging-fixture",
    synthetic: true,
    source: "api/admin/firebase-identity",
    createdAt: now.toISOString(),
    expireAt: new Date(now.getTime() + PROBE_TTL_MS),
  };
  try {
    const ref = getAdminDb().collection(PROBE_COLLECTION).doc(id);
    await ref.create(data);
    const back = await ref.get();
    const matches = back.exists && back.get("createdAt") === data.createdAt && back.get("marker") === data.marker;
    return NextResponse.json({
      ok: true,
      projectId: target.projectId,
      collection: PROBE_COLLECTION,
      id,
      readBack: matches ? "match" : "mismatch",
    });
  } catch (cause) {
    return fail(toAppError(cause, "The staging probe could not be written."));
  }
}
