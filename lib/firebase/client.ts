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

/** Lazily initialized — never call unless `isFirebaseConfigured` is true. */
export async function getFirebaseAuth(): Promise<Auth> {
  if (!authInstance) {
    const { getAuth } = await import("firebase/auth");
    authInstance = getAuth(await getFirebaseApp());
  }
  return authInstance;
}

export async function getFirebaseDb(): Promise<Firestore> {
  if (!dbInstance) {
    const { getFirestore } = await import("firebase/firestore");
    dbInstance = getFirestore(await getFirebaseApp());
  }
  return dbInstance;
}

export async function getFirebaseStorage(): Promise<FirebaseStorage> {
  if (!storageInstance) {
    const { getStorage } = await import("firebase/storage");
    storageInstance = getStorage(await getFirebaseApp());
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
