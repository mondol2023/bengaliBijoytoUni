/**
 * The runtime identity check and the controlled probe. What matters most:
 * the probe never writes when the running deployment's Admin SDK is
 * Production, and GET returns project ids and nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppErrors } from "@/lib/errors/types";

const state = vi.hoisted(() => ({
  identity: { projectId: "legacy2uni-staging", serviceAccountProjectId: "legacy2uni-staging", emulated: false } as {
    projectId: string | null;
    serviceAccountProjectId: string | null;
    emulated: boolean;
  },
  create: vi.fn(),
  get: vi.fn(),
  doc: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireAdminUser: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({
  isFirebaseAdminConfigured: true,
  getAdminFirebaseIdentity: () => state.identity,
  getAdminDb: () => ({ collection: () => ({ doc: state.doc }) }),
}));

import { requireAdminUser } from "@/lib/auth/session";
import { STAGING_REFUSAL_MESSAGE } from "@/lib/firebase/projectGuard";
import { GET, POST } from "./route";

const ROUTE_URL = "http://localhost/api/admin/firebase-identity";
const request = (method: "GET" | "POST") =>
  new NextRequest(ROUTE_URL, { method, headers: { authorization: "Bearer test-token" } });

let written: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  written = null;
  state.identity = { projectId: "legacy2uni-staging", serviceAccountProjectId: "legacy2uni-staging", emulated: false };
  vi.mocked(requireAdminUser).mockResolvedValue({
    ok: true,
    value: { uid: "admin-1" },
  } as unknown as Awaited<ReturnType<typeof requireAdminUser>>);
  state.create.mockImplementation(async (data: Record<string, unknown>) => {
    written = data;
  });
  state.get.mockImplementation(async () => ({
    exists: written !== null,
    get: (field: string) => written?.[field],
  }));
  state.doc.mockImplementation((id: string) => ({ id, create: state.create, get: state.get }));
});

describe("GET /api/admin/firebase-identity", () => {
  it("reports project ids only", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "legacy2uni-staging");
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      vercelEnv: "preview",
      clientProjectId: "legacy2uni-staging",
      adminProjectId: "legacy2uni-staging",
      serviceAccountProjectId: "legacy2uni-staging",
      emulated: false,
      targetsProduction: false,
    });
  });

  it("says so when the deployment targets Production", async () => {
    state.identity = { projectId: "legacy2uni", serviceAccountProjectId: "legacy2uni", emulated: false };
    expect((await (await GET(request("GET"))).json()).targetsProduction).toBe(true);
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({
      ok: false,
      error: AppErrors.authorization("Admins only."),
    } as unknown as Awaited<ReturnType<typeof requireAdminUser>>);
    expect((await GET(request("GET"))).status).toBe(403);
  });
});

describe("POST /api/admin/firebase-identity (controlled probe)", () => {
  it("writes and reads back one synthetic document on staging", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, projectId: "legacy2uni-staging", collection: "stagingProbes", readBack: "match" });
    expect(body.id).toMatch(/^probe-/);
    expect(written).toMatchObject({ marker: "staging-fixture", synthetic: true });
    expect(written?.expireAt).toBeInstanceOf(Date);
  });

  it("refuses on Production and writes nothing", async () => {
    state.identity = { projectId: "legacy2uni", serviceAccountProjectId: "legacy2uni", emulated: false };
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe(STAGING_REFUSAL_MESSAGE);
    expect(state.doc).not.toHaveBeenCalled();
  });

  it("refuses a Production service account under a staging project id", async () => {
    state.identity = { projectId: "legacy2uni-staging", serviceAccountProjectId: "legacy2uni", emulated: false };
    expect((await POST(request("POST"))).status).toBe(403);
    expect(state.doc).not.toHaveBeenCalled();
  });

  it("refuses when no project is configured", async () => {
    state.identity = { projectId: null, serviceAccountProjectId: null, emulated: true };
    expect((await POST(request("POST"))).status).toBe(403);
    expect(state.doc).not.toHaveBeenCalled();
  });

  it("is admin-only and writes nothing for a non-admin", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({
      ok: false,
      error: AppErrors.authorization("Admins only."),
    } as unknown as Awaited<ReturnType<typeof requireAdminUser>>);
    expect((await POST(request("POST"))).status).toBe(403);
    expect(state.doc).not.toHaveBeenCalled();
  });
});
