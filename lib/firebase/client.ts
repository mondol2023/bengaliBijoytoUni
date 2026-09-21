"use client";

import type { FirebaseApp } from "firebase/app";
import type { Auth, GoogleAuthProvider } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Whether real Firebase project credentials are present. False until
 * `docs/firebase-setup.md` has been followed and `.env.local` populated — in
 * that state auth/persistence UI shows a "not configured" message instead of
 * throwing, so the rest of the app (converter/documents/compare, all of
 * which work with zero Firebase dependency) keeps working untouched.
 *
 * This is a plain environment check, so it stays synchronous and pulls in no
 * Firebase code — callers can branch on it before paying for any of it.
 */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

/**
 * Whether this browser build should talk to the local emulators
 * (`docs/dev-environment.md`). Unlike the server, the browser cannot read
 * `FIRESTORE_EMULATOR_HOST` and the SDK has no equivalent auto-detection, so
 * each service is redirected by an explicit `connect*Emulator` call below.
 *
 * Inlined at build time like every `NEXT_PUBLIC_*` value, so a production
 * build compiled without it can never take these branches.
 */
const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "1";

/**
 * Ports must match `firebase.json`'s `emulators` block. Hard-coded rather
 * than read from more `NEXT_PUBLIC_*` variables: they are not secrets, not
 * per-developer, and one list is easier to keep in step with `firebase.json`
 * than six env vars are.
 */
const EMULATOR = {
  host: "127.0.0.1",
  authPort: 9099,
  firestorePort: 8080,
  storagePort: 9199,
} as const;

/**
 * Every accessor below is async because the SDK is imported on demand rather
 * than at module scope. `AuthProvider` mounts in the root layout, so a static
 * `firebase/auth` import there put the whole Auth SDK — plus Firestore and
 * Storage, which nothing on a public page touches — into the first load of
 * every route, landing page included. Deferring it means an unconfigured or
 * signed-out visitor never downloads any of it.
 *
 * The instances are still cached, so the dynamic import resolves from the
 * module cache on every call after the first.
 */

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let storageInstance: FirebaseStorage | undefined;
let googleProviderInstance: GoogleAuthProvider | undefined;

async function getFirebaseApp(): Promise<FirebaseApp> {
  if (!app) {
    const { initializeApp, getApps } = await import("firebase/app");
    app = getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseConfig);
  }
  return app;
}

/**
 * Lazily initialized — never call unless `isFirebaseConfigured` is true.
 *
 * The `connect*Emulator` calls sit inside the same `if (!instance)` block as
 * construction, so each runs exactly once per instance. Calling one twice on
 * the same object throws in the Firestore SDK, which is the failure mode
 * that would otherwise appear only after a fast-refresh.
 */
export async function getFirebaseAuth(): Promise<Auth> {
  if (!authInstance) {
    const { getAuth, connectAuthEmulator } = await import("firebase/auth");
    authInstance = getAuth(await getFirebaseApp());
    if (useEmulator) {
      connectAuthEmulator(authInstance, `http://${EMULATOR.host}:${EMULATOR.authPort}`, {
        disableWarnings: true,
      });
    }
  }
  return authInstance;
}

export async function getFirebaseDb(): Promise<Firestore> {
  if (!dbInstance) {
    const { getFirestore, connectFirestoreEmulator } = await import("firebase/firestore");
    dbInstance = getFirestore(await getFirebaseApp());
    if (useEmulator) {
      connectFirestoreEmulator(dbInstance, EMULATOR.host, EMULATOR.firestorePort);
    }
  }
  return dbInstance;
}

export async function getFirebaseStorage(): Promise<FirebaseStorage> {
  if (!storageInstance) {
    const { getStorage, connectStorageEmulator } = await import("firebase/storage");
    storageInstance = getStorage(await getFirebaseApp());
    if (useEmulator) {
      connectStorageEmulator(storageInstance, EMULATOR.host, EMULATOR.storagePort);
    }
  }
  return storageInstance;
}

/** Constructed lazily too, so an unconfigured project never touches `firebase/auth` internals. */
export async function getGoogleProvider(): Promise<GoogleAuthProvider> {
  if (!googleProviderInstance) {
    const { GoogleAuthProvider } = await import("firebase/auth");
    googleProviderInstance = new GoogleAuthProvider();
  }
  return googleProviderInstance;
}
