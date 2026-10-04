import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAGING_REFUSAL_MESSAGE } from "../projectGuard";

const initializeApp = vi.fn(() => ({ name: "app" }));

vi.mock("firebase-admin/app", () => ({
  cert: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  initializeApp,
}));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: vi.fn(() => ({ kind: "db" })) }));
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn(() => ({})) }));
vi.mock("firebase-admin/storage", () => ({ getStorage: vi.fn(() => ({})) }));

const PROD_EMAIL = "firebase-adminsdk-x1@legacy2uni.iam.gserviceaccount.com";
const STAGING_EMAIL = "convert2uni-server@legacy2uni-staging.iam.gserviceaccount.com";

function configure(env: { vercelEnv?: string; projectId: string; clientEmail: string }) {
  vi.stubEnv("VERCEL_ENV", env.vercelEnv as string);
  vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", env.projectId);
  vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", env.clientEmail);
  vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "not-a-real-key");
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", "");
}

beforeEach(() => {
  vi.resetModules();
  initializeApp.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin SDK: Preview never initializes against Production", () => {
  it("throws the refusal on a Preview deployment configured for legacy2uni, before initializing", async () => {
    configure({ vercelEnv: "preview", projectId: "legacy2uni", clientEmail: PROD_EMAIL });
    const admin = await import("../admin");
    expect(() => admin.getAdminDb()).toThrow(STAGING_REFUSAL_MESSAGE);
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("throws when a Production service account is paired with a staging project id", async () => {
    configure({ vercelEnv: "preview", projectId: "legacy2uni-staging", clientEmail: PROD_EMAIL });
    const admin = await import("../admin");
    expect(() => admin.getAdminDb()).toThrow(STAGING_REFUSAL_MESSAGE);
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("initializes a Preview deployment configured for staging", async () => {
    configure({ vercelEnv: "preview", projectId: "legacy2uni-staging", clientEmail: STAGING_EMAIL });
    const admin = await import("../admin");
    expect(() => admin.getAdminDb()).not.toThrow();
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(admin.getAdminFirebaseIdentity()).toEqual({
      projectId: "legacy2uni-staging",
      serviceAccountProjectId: "legacy2uni-staging",
      emulated: false,
    });
  });

  it("leaves the Production deployment on legacy2uni untouched", async () => {
    configure({ vercelEnv: "production", projectId: "legacy2uni", clientEmail: PROD_EMAIL });
    const admin = await import("../admin");
    expect(() => admin.getAdminDb()).not.toThrow();
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it("leaves a local run (no VERCEL_ENV) untouched", async () => {
    configure({ projectId: "legacy2uni", clientEmail: PROD_EMAIL });
    const admin = await import("../admin");
    expect(() => admin.getAdminDb()).not.toThrow();
  });
});
