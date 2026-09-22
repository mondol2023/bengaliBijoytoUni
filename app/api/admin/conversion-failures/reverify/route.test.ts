/**
 * The engine-change trigger, end to end from an admin HTTP request through
 * authentication → validation → the sweep → a safe JSON response, without
 * touching real Firestore.
 *
 * The case that matters most is the last one: the body cannot carry an
 * answer. `failurePatterns.status` is published, so a route that took a
 * status would let a caller retire real gaps by asking.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppErrors } from "@/lib/errors/types";

vi.mock("@/lib/auth/session", () => ({ requireAdminUser: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ isFirebaseAdminConfigured: true }));
vi.mock("@/lib/firebase/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/firebase/reverifyPatterns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/firebase/reverifyPatterns")>();
  return { ...actual, reverifyStoredPatterns: vi.fn() };
});
vi.mock("@/lib/security/rateLimit", () => ({ checkRateLimit: vi.fn() }));

import { requireAdminUser } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/firebase/audit";
import { reverifyStoredPatterns } from "@/lib/firebase/reverifyPatterns";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { CONVERSION_ENGINE_VERSION } from "@/features/converter/engine/version";
import { POST } from "./route";

const ADMIN_UID = "admin-uid-1";
const ROUTE_URL = "http://localhost/api/admin/conversion-failures/reverify";

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest(ROUTE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdminUser).mockResolvedValue({
    ok: true,
    value: { uid: ADMIN_UID },
  } as unknown as Awaited<ReturnType<typeof requireAdminUser>>);
  vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as ReturnType<typeof checkRateLimit>);
  vi.mocked(reverifyStoredPatterns).mockResolvedValue({
    ok: true,
    value: { examined: 3, resolved: ["pattern-a"], reopened: ["pattern-c"] },
  });
});

describe("POST /api/admin/conversion-failures/reverify", () => {
  it("sweeps and reports what moved", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      engineVersion: CONVERSION_ENGINE_VERSION,
      examined: 3,
      resolved: ["pattern-a"],
      reopened: ["pattern-c"],
    });
  });

  it("treats a missing body as the whole-window sweep", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(reverifyStoredPatterns).toHaveBeenCalledWith({ encodingId: undefined, limit: undefined });
  });

  it("passes a chosen encoding and limit through", async () => {
    await POST(makeRequest({ encodingId: "bijoy", limit: 25 }));
    expect(reverifyStoredPatterns).toHaveBeenCalledWith({ encodingId: "bijoy", limit: 25 });
  });

  it("passes an unknown encoding to the sweep, which refuses it", async () => {
    // Validated in the sweep rather than here: this directory may not
    // import the encoding registry (lib/ai/__tests__/invariants.test.ts).
    vi.mocked(reverifyStoredPatterns).mockResolvedValue({
      ok: false,
      error: AppErrors.validation('Unknown encoding "not-an-encoding".', {
        details: { field: "encodingId" },
      }),
    });
    const response = await POST(makeRequest({ encodingId: "not-an-encoding" }));
    expect(response.status).toBe(400);
  });

  it("refuses a limit above the ceiling", async () => {
    const response = await POST(makeRequest({ limit: 100_000 }));
    expect(response.status).toBe(400);
    expect(reverifyStoredPatterns).not.toHaveBeenCalled();
  });

  it("requires an admin", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({
      ok: false,
      error: AppErrors.authorization("Nope."),
    } as unknown as Awaited<ReturnType<typeof requireAdminUser>>);
    const response = await POST(makeRequest({}));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(reverifyStoredPatterns).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: false,
      error: AppErrors.rateLimit("Slow down.", { details: { retryAfterSeconds: 60 } }),
    } as ReturnType<typeof checkRateLimit>);
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(429);
    expect(reverifyStoredPatterns).not.toHaveBeenCalled();
  });

  it("audits who ran it and what moved", async () => {
    await POST(makeRequest({ encodingId: "bijoy" }));
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: ADMIN_UID,
        action: "conversion_failure_reverify",
        metadata: expect.objectContaining({ examined: 3, resolved: 1, reopened: 1 }),
      }),
    );
  });

  it("takes no status, verdict or pattern id from the caller", async () => {
    await POST(
      makeRequest({
        encodingId: "bijoy",
        status: "resolved",
        verdict: "converts_now",
        patternId: "pattern-a",
      }),
    );
    // Only the window survives parsing; the extra keys are stripped, never
    // forwarded to the sweep.
    expect(reverifyStoredPatterns).toHaveBeenCalledWith({ encodingId: "bijoy", limit: undefined });
  });
});
