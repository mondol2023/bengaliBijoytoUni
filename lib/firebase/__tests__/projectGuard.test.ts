import { describe, expect, it } from "vitest";
import {
  PRODUCTION_FIREBASE_PROJECT_ID,
  STAGING_REFUSAL_MESSAGE,
  checkStagingTarget,
  isWellFormedProjectId,
  previewProductionConflict,
  serviceAccountProjectId,
} from "../projectGuard";
import { PROD_SERVICE_ACCOUNT, STAGING_SERVICE_ACCOUNT } from "./syntheticAccounts";

describe("checkStagingTarget", () => {
  it("accepts a well-formed staging project id", () => {
    expect(checkStagingTarget("legacy2uni-staging")).toEqual({ ok: true, projectId: "legacy2uni-staging" });
  });

  it("refuses the Production project with the exact refusal message", () => {
    const result = checkStagingTarget(PRODUCTION_FIREBASE_PROJECT_ID);
    expect(result).toEqual({ ok: false, problem: "production", message: STAGING_REFUSAL_MESSAGE });
    expect(STAGING_REFUSAL_MESSAGE).toBe(
      "Refusing staging operation: target project is the Production Firebase project.",
    );
  });

  it.each([undefined, null, ""])("refuses a missing id (%j) rather than falling back", (value) => {
    const result = checkStagingTarget(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("missing");
  });

  it.each([
    " legacy2uni-staging",
    "legacy2uni-staging ",
    "Legacy2uni-Staging",
    "short",
    "1legacy2uni",
    "legacy2uni-",
    "legacy_2uni_staging",
    "a".repeat(31),
  ])("refuses a malformed id %j", (value) => {
    const result = checkStagingTarget(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("malformed");
  });

  it("refuses Production even with whitespace around it, as malformed rather than accepted", () => {
    expect(checkStagingTarget(" legacy2uni").ok).toBe(false);
    expect(checkStagingTarget("legacy2uni\n").ok).toBe(false);
  });

  it("refuses an emulator-only demo- id", () => {
    const result = checkStagingTarget("demo-convert2uni");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("emulator-only");
  });

  it("does not mistake a staging id that starts with the Production id for Production", () => {
    expect(checkStagingTarget("legacy2uni-preview-7f3a").ok).toBe(true);
  });
});

describe("isWellFormedProjectId", () => {
  it("follows the Google Cloud grammar", () => {
    expect(isWellFormedProjectId("legacy2uni")).toBe(true);
    expect(isWellFormedProjectId("abcdef")).toBe(true);
    expect(isWellFormedProjectId("abcde")).toBe(false);
    expect(isWellFormedProjectId(42)).toBe(false);
  });
});

describe("serviceAccountProjectId", () => {
  it("reads the project out of a service-account email", () => {
    expect(serviceAccountProjectId(STAGING_SERVICE_ACCOUNT)).toBe(
      "legacy2uni-staging",
    );
    expect(serviceAccountProjectId(PROD_SERVICE_ACCOUNT)).toBe("legacy2uni");
  });

  it("returns null for anything that is not a project service account", () => {
    expect(serviceAccountProjectId(undefined)).toBeNull();
    expect(serviceAccountProjectId("someone@example.com")).toBeNull();
    expect(serviceAccountProjectId("legacy2uni@appspot.gserviceaccount.com")).toBeNull();
  });
});

describe("previewProductionConflict", () => {
  const prodEmail = PROD_SERVICE_ACCOUNT;
  const stagingEmail = STAGING_SERVICE_ACCOUNT;

  it("refuses a Preview deployment whose Admin SDK project is Production", () => {
    expect(
      previewProductionConflict({ vercelEnv: "preview", adminProjectId: "legacy2uni", clientEmail: stagingEmail }),
    ).toBe(STAGING_REFUSAL_MESSAGE);
  });

  it("refuses a Preview deployment holding a Production service account under a staging project id", () => {
    expect(
      previewProductionConflict({ vercelEnv: "preview", adminProjectId: "legacy2uni-staging", clientEmail: prodEmail }),
    ).toBe(STAGING_REFUSAL_MESSAGE);
  });

  it("allows a Preview deployment on staging", () => {
    expect(
      previewProductionConflict({
        vercelEnv: "preview",
        adminProjectId: "legacy2uni-staging",
        clientEmail: stagingEmail,
      }),
    ).toBeNull();
  });

  it.each([["production"], ["development"], [undefined]])(
    "leaves VERCEL_ENV=%s on Production alone",
    (vercelEnv) => {
      expect(
        previewProductionConflict({ vercelEnv, adminProjectId: "legacy2uni", clientEmail: prodEmail }),
      ).toBeNull();
    },
  );
});
