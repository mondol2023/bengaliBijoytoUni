#!/usr/bin/env node
/**
 * One-off script to grant a user the `admin: true` custom claim — the sole
 * source of admin authorization in this app (see lib/auth/session.ts and
 * lib/firebase/schemas.ts's userProfileSchema, which deliberately has no
 * `role` field). Run this manually once per admin; there is no in-app UI for
 * granting the *first* admin, since Phase 7's admin dashboard itself
 * requires an existing admin to reach it.
 *
 * Usage:
 *   node scripts/setAdminClaim.mjs <uid>
 *   node scripts/setAdminClaim.mjs <uid> --revoke
 *
 * Requires the same FIREBASE_ADMIN_* env vars as the app itself (see
 * .env.local.example / docs/firebase-setup.md) — load them into the shell
 * environment first, e.g.:
 *   set -a && source .env.local && set +a && node scripts/setAdminClaim.mjs <uid>
 */

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [, , uid, flag] = process.argv;

if (!uid) {
  console.error("Usage: node scripts/setAdminClaim.mjs <uid> [--revoke]");
  process.exit(1);
}

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "Missing FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY in the environment.",
  );
  process.exit(1);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });

const grant = flag !== "--revoke";
await getAuth().setCustomUserClaims(uid, grant ? { admin: true } : {});

console.log(`${grant ? "Granted" : "Revoked"} admin claim for uid: ${uid}`);
console.log("The user must sign out and back in (or wait for their ID token to refresh) for this to take effect.");
