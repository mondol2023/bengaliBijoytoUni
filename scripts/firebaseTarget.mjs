/**
 * The staging-target guard for plain-Node scripts. Restates
 * `lib/firebase/projectGuard.ts`, which is the definition; the script test
 * (`lib/firebase/__tests__/firebaseTarget.script.test.ts`) keeps the two in
 * step, the same arrangement `checkClientFlags.mjs` has with `serveFlags.ts`.
 *
 * Every mutating staging script calls `requireStagingTarget` before it builds
 * a Firebase client or spawns the Firebase CLI. It throws; nothing here warns.
 */

export const PRODUCTION_FIREBASE_PROJECT_ID = "legacy2uni";

export const STAGING_REFUSAL_MESSAGE =
  "Refusing staging operation: target project is the Production Firebase project.";

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export function isWellFormedProjectId(value) {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
}

/** Same contract as `checkStagingTarget` in `lib/firebase/projectGuard.ts`. */
export function checkStagingTarget(value) {
  if (value === undefined || value === null || value === "") {
    return {
      ok: false,
      problem: "missing",
      message: "Refusing staging operation: no staging Firebase project id was given.",
    };
  }
  if (value === PRODUCTION_FIREBASE_PROJECT_ID) {
    return { ok: false, problem: "production", message: STAGING_REFUSAL_MESSAGE };
  }
  if (!isWellFormedProjectId(value)) {
    return {
      ok: false,
      problem: "malformed",
      message: `Refusing staging operation: ${JSON.stringify(value)} is not a valid Firebase project id.`,
    };
  }
  if (value.startsWith("demo-")) {
    return {
      ok: false,
      problem: "emulator-only",
      message: `Refusing staging operation: ${value} is an emulator-only project id.`,
    };
  }
  return { ok: true, projectId: value };
}

export function serviceAccountProjectId(clientEmail) {
  if (typeof clientEmail !== "string") return null;
  const match = /^[^@\s]+@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$/.exec(clientEmail);
  return match ? match[1] : null;
}

/**
 * The target for a staging script, from `STAGING_FIREBASE_PROJECT_ID` and
 * nothing else — never `firebase use`, never `.firebaserc`, never a default.
 *
 * With `admin: true` the Admin SDK variables must agree with it as well:
 * `FIREBASE_ADMIN_PROJECT_ID` equal to the staging id, and the service
 * account's email naming the same project. That is what stops a staging id
 * typed correctly in one variable from riding along with a Production
 * credential in another.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ admin?: boolean }} [options]
 * @returns {string} the staging project id
 */
export function requireStagingTarget(env, options = {}) {
  const check = checkStagingTarget(env.STAGING_FIREBASE_PROJECT_ID);
  if (!check.ok) throw new Error(check.message);
  const staging = check.projectId;

  if (options.admin) {
    if (env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "Refusing staging operation: FIRESTORE_EMULATOR_HOST is set, so this would write to the emulator, not staging.",
      );
    }
    const adminProject = env.FIREBASE_ADMIN_PROJECT_ID;
    if (adminProject === PRODUCTION_FIREBASE_PROJECT_ID) throw new Error(STAGING_REFUSAL_MESSAGE);
    if (adminProject !== staging) {
      throw new Error(
        `Refusing staging operation: FIREBASE_ADMIN_PROJECT_ID (${JSON.stringify(adminProject ?? null)}) ` +
          `does not match STAGING_FIREBASE_PROJECT_ID (${staging}).`,
      );
    }
    const accountProject = serviceAccountProjectId(env.FIREBASE_ADMIN_CLIENT_EMAIL);
    if (accountProject === PRODUCTION_FIREBASE_PROJECT_ID) throw new Error(STAGING_REFUSAL_MESSAGE);
    if (accountProject !== staging) {
      throw new Error(
        "Refusing staging operation: FIREBASE_ADMIN_CLIENT_EMAIL is not a service account of " +
          `${staging} (it names ${JSON.stringify(accountProject)}).`,
      );
    }
  }
  return staging;
}
