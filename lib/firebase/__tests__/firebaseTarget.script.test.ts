/**
 * `scripts/firebaseTarget.mjs` restates `projectGuard.ts` for plain-Node
 * scripts. The first block catches drift between the two; the second covers
 * the part only the script has — cross-checking the Admin SDK variables
 * against the staging id before anything is written.
 */
import { describe, expect, it } from "vitest";
import * as guard from "../projectGuard";
import { PROD_SERVICE_ACCOUNT, serviceAccount } from "./syntheticAccounts";
// Plain .mjs with no declarations; `allowJs` lets tsc infer its shape.
import * as script from "../../../scripts/firebaseTarget.mjs";

const STAGING = "legacy2uni-staging";
const STAGING_EMAIL = serviceAccount("convert2uni-server", STAGING);
const PROD_EMAIL = PROD_SERVICE_ACCOUNT;

describe("firebaseTarget.mjs agrees with projectGuard.ts", () => {
  it("names the same Production project and refusal", () => {
    expect(script.PRODUCTION_FIREBASE_PROJECT_ID).toBe(guard.PRODUCTION_FIREBASE_PROJECT_ID);
    expect(script.STAGING_REFUSAL_MESSAGE).toBe(guard.STAGING_REFUSAL_MESSAGE);
  });

  it.each([
    undefined,
    null,
    "",
    "legacy2uni",
    STAGING,
    "legacy2uni-preview-7f3a",
    "demo-convert2uni",
    " legacy2uni",
    "Legacy2uni",
    "short",
    "x".repeat(31),
  ])("classifies %j identically", (value) => {
    expect(script.checkStagingTarget(value)).toEqual(guard.checkStagingTarget(value));
  });

  it.each([undefined, STAGING_EMAIL, PROD_EMAIL, "a@example.com", "legacy2uni@appspot.gserviceaccount.com"])(
    "reads the service-account project of %j identically",
    (email) => {
      expect(script.serviceAccountProjectId(email)).toBe(guard.serviceAccountProjectId(email));
    },
  );
});

describe("requireStagingTarget", () => {
  const adminEnv = {
    STAGING_FIREBASE_PROJECT_ID: STAGING,
    FIREBASE_ADMIN_PROJECT_ID: STAGING,
    FIREBASE_ADMIN_CLIENT_EMAIL: STAGING_EMAIL,
  };

  it("returns the staging id when every variable agrees", () => {
    expect(script.requireStagingTarget(adminEnv, { admin: true })).toBe(STAGING);
    expect(script.requireStagingTarget({ STAGING_FIREBASE_PROJECT_ID: STAGING })).toBe(STAGING);
  });

  it("refuses when STAGING_FIREBASE_PROJECT_ID is missing, with no fallback", () => {
    expect(() => script.requireStagingTarget({ FIREBASE_ADMIN_PROJECT_ID: "legacy2uni" })).toThrow(
      /no staging Firebase project id/,
    );
  });

  it("refuses Production named as the staging project", () => {
    expect(() => script.requireStagingTarget({ STAGING_FIREBASE_PROJECT_ID: "legacy2uni" })).toThrow(
      guard.STAGING_REFUSAL_MESSAGE,
    );
  });

  it("refuses an Admin SDK project of legacy2uni even when the staging id is right", () => {
    expect(() =>
      script.requireStagingTarget({ ...adminEnv, FIREBASE_ADMIN_PROJECT_ID: "legacy2uni" }, { admin: true }),
    ).toThrow(guard.STAGING_REFUSAL_MESSAGE);
  });

  it("refuses a Production service account under staging project ids", () => {
    expect(() =>
      script.requireStagingTarget({ ...adminEnv, FIREBASE_ADMIN_CLIENT_EMAIL: PROD_EMAIL }, { admin: true }),
    ).toThrow(guard.STAGING_REFUSAL_MESSAGE);
  });

  it("refuses an Admin SDK project that is some other project", () => {
    expect(() =>
      script.requireStagingTarget({ ...adminEnv, FIREBASE_ADMIN_PROJECT_ID: "someone-else" }, { admin: true }),
    ).toThrow(/does not match/);
    expect(() =>
      script.requireStagingTarget({ ...adminEnv, FIREBASE_ADMIN_PROJECT_ID: undefined }, { admin: true }),
    ).toThrow(/does not match/);
  });

  it("refuses a service account from another project", () => {
    expect(() =>
      script.requireStagingTarget(
        { ...adminEnv, FIREBASE_ADMIN_CLIENT_EMAIL: serviceAccount("x", "someone-else") },
        { admin: true },
      ),
    ).toThrow(/is not a service account of/);
  });

  it("refuses when the emulator host is set, because that is not staging", () => {
    expect(() =>
      script.requireStagingTarget({ ...adminEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, { admin: true }),
    ).toThrow(/emulator/);
  });
});
