/**
 * Server-only Firebase Admin SDK wiring. Never import this from a Client
 * Component or anything that ends up in a browser bundle — it reads a
 * service-account private key from the environment.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
// .env files can't hold real newlines in a value; the setup doc has the
// service account key pasted with literal "\n" escapes, unescaped here.
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
const storageBucket = process.env.FIREBASE_ADMIN_STORAGE_BUCKET;

/**
 * False until `docs/firebase-setup.md`'s service-account env vars are set.
 * Every function below throws a clear, typed error if called while this is
 * false — callers should check it (or catch and fall back) rather than let
 * that surprise a request in production before setup is done.
 */
export const isFirebaseAdminConfigured = Boolean(projectId && clientEmail && privateKey);

let app: App | undefined;

function getAdminApp(): App {
  if (!isFirebaseAdminConfigured) {
    throw new Error(
      "Firebase admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, " +
        "and FIREBASE_ADMIN_PRIVATE_KEY — see docs/firebase-setup.md.",
    );
  }
  if (!app) {
    app =
      getApps().length > 0
        ? getApps()[0]!
        : initializeApp({
            credential: cert({ projectId, clientEmail, privateKey }),
            storageBucket,
          });
  }
  return app;
}

let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let storageInstance: Storage | undefined;

export function getAdminAuth(): Auth {
  authInstance ??= getAuth(getAdminApp());
  return authInstance;
}

export function getAdminDb(): Firestore {
  dbInstance ??= getFirestore(getAdminApp());
  return dbInstance;
}

export function getAdminStorage(): Storage {
  storageInstance ??= getStorage(getAdminApp());
  return storageInstance;
}
