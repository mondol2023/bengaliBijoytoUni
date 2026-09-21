/**
 * Server-only Firebase Admin SDK wiring. Never import this from a Client
 * Component or anything that ends up in a browser bundle — it reads a
 * service-account private key from the environment.
 *
 * ## Two initialization modes
 *
 * **Real project.** A service account (`FIREBASE_ADMIN_*`) is required, and
 * `cert()` builds a credential from it.
 *
 * **Emulator.** `FIRESTORE_EMULATOR_HOST` being set means the Firestore
 * emulator is the target, and the emulator authenticates nobody: there is no
 * service account, and `cert()` would reject a fake private key outright. So
 * the emulator gets its own branch — `initializeApp({ projectId })` with no
 * credential — rather than being handed dummy values.
 *
 * The SDKs find the emulators themselves from `FIRESTORE_EMULATOR_HOST`,
 * `FIREBASE_AUTH_EMULATOR_HOST` and `FIREBASE_STORAGE_EMULATOR_HOST` (all
 * `host:port`, no scheme — verified against the installed
 * `@google-cloud/firestore` and `firebase-admin@14.4.0`). Nothing below has
 * to route to them; the branch here exists only for the credential.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
// .env files can't hold real newlines in a value; the setup doc has the
// service account key pasted with literal "\n" escapes, unescaped here.
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\n/g, "\n");
const storageBucket = process.env.FIREBASE_ADMIN_STORAGE_BUCKET;
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

/**
 * True when the Admin SDK is pointed at a local emulator rather than a real
 * project. Exported so a route or a diagnostic can say which it is; nothing
 * behavioural should branch on it beyond initialization.
 */
export const isFirebaseEmulated = Boolean(firestoreEmulatorHost);

/**
 * False until `docs/firebase-setup.md`'s service-account env vars are set, or
 * the emulator is running (`docs/dev-environment.md`), in which case no
 * credential is needed and this is true with none present. Every function
 * below throws a clear, typed error if called while this is false — callers
 * should check it (or catch and fall back) rather than let that surprise a
 * request in production before setup is done.
 */
export const isFirebaseAdminConfigured =
  isFirebaseEmulated || Boolean(projectId && clientEmail && privateKey);

let app: App | undefined;

function getAdminApp(): App {
  if (!isFirebaseAdminConfigured) {
    throw new Error(
      "Firebase admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, " +
        "and FIREBASE_ADMIN_PRIVATE_KEY — see docs/firebase-setup.md.",
    );
  }
  if (!app) {
    if (getApps().length > 0) {
      app = getApps()[0]!;
    } else if (isFirebaseEmulated) {
      // A project id is still required — it namespaces the emulator's data —
      // but a credential is not, and supplying a fake one fails.
      app = initializeApp({ projectId: projectId || "demo-convert2uni", storageBucket });
    } else {
      app = initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
        storageBucket,
      });
    }
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
