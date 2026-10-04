/**
 * Which Firebase project a staging/Preview operation may target, decided in
 * one place so a script, the release check and the server agree.
 *
 * Phase 10 (docs/staging-environment.md). The one invariant: **nothing that
 * calls itself staging may resolve to the Production project.** Every check
 * here fails closed — a missing, malformed or Production id is a refusal, not
 * a warning, and there is no default to fall back to.
 *
 * Pure: no Firebase import, no env read. Callers pass the values in, which is
 * what lets `__tests__/projectGuard.test.ts` cover every branch.
 * `scripts/firebaseTarget.mjs` restates this for the plain-Node scripts; the
 * script test keeps the two in step.
 */

/** The Production Firebase project. Never a staging target. */
export const PRODUCTION_FIREBASE_PROJECT_ID = "legacy2uni";

export const STAGING_REFUSAL_MESSAGE =
  "Refusing staging operation: target project is the Production Firebase project.";

/**
 * Google Cloud's project-id grammar: 6–30 characters, lowercase letters,
 * digits and hyphens, starting with a letter and not ending with a hyphen.
 */
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export function isWellFormedProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
}

export type StagingTargetProblem = "missing" | "malformed" | "production" | "emulator-only";

export type StagingTargetCheck =
  | { readonly ok: true; readonly projectId: string }
  | { readonly ok: false; readonly problem: StagingTargetProblem; readonly message: string };

/**
 * Whether `value` may be used as the staging project. Not trimmed: a project
 * id with whitespace round it is a configuration mistake to surface, not to
 * tidy away.
 *
 * `demo-*` ids are rejected too. They are the emulator's namespace
 * (`docs/dev-environment.md` §5) and do not exist as real projects, so a
 * staging configuration carrying one is pointed at nothing.
 */
export function checkStagingTarget(value: string | null | undefined): StagingTargetCheck {
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

/**
 * The project a service account belongs to, read off its email:
 * `<name>@<project>.iam.gserviceaccount.com`. `null` for anything else —
 * including the App Engine default account (`<project>@appspot.gserviceaccount.com`),
 * which this app should never be using.
 */
export function serviceAccountProjectId(clientEmail: string | null | undefined): string | null {
  if (typeof clientEmail !== "string") return null;
  const match = /^[^@\s]+@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$/.exec(clientEmail);
  return match ? match[1]! : null;
}

/**
 * The server-side refusal: a Vercel **Preview** deployment whose Admin SDK is
 * pointed at Production. Returns the message to throw, or `null` when the
 * pairing is allowed.
 *
 * Keyed on `VERCEL_ENV`, which Vercel sets on every deployment
 * (`production`, `preview` or `development`) and which is unset locally. So
 * Production and local runs are untouched, and only the one pairing the
 * owner ruled out (release-record-phase9.md, decision B) is refused.
 */
export function previewProductionConflict(input: {
  readonly vercelEnv: string | undefined;
  readonly adminProjectId: string | undefined;
  readonly clientEmail: string | undefined;
}): string | null {
  if (input.vercelEnv !== "preview") return null;
  if (input.adminProjectId === PRODUCTION_FIREBASE_PROJECT_ID) return STAGING_REFUSAL_MESSAGE;
  if (serviceAccountProjectId(input.clientEmail) === PRODUCTION_FIREBASE_PROJECT_ID) {
    return STAGING_REFUSAL_MESSAGE;
  }
  return null;
}
