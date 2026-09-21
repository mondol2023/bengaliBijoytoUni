import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The admin list's two orderings. `sort=frequent` is the top-N-by-occurrence
 * view; the default stays recency, because every existing caller and
 * bookmark depends on it.
 */
const state = vi.hoisted(() => ({ adminConfigured: true, admin: true }));

vi.mock("@/lib/firebase/admin", () => ({
  get isFirebaseAdminConfigured() {
    return state.adminConfigured;
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdminUser: vi.fn(async () =>
    state.admin
      ? { ok: true as const, value: { uid: "admin-1" } }
      : { ok: false as const, error: { code: "FORBIDDEN_ERROR", message: "Admins only." } },
  ),
}));

vi.mock("@/lib/firebase/conversionFailures", () => ({
  listFailurePatterns: vi.fn(async () => []),
  summarizeFailurePatterns: vi.fn(() => ({
    totalPatterns: 0,
    totalOccurrences: 0,
    byCategory: {},
    openCount: 0,
    resolvedCount: 0,
  })),
}));

import { listFailurePatterns } from "@/lib/firebase/conversionFailures";
import { GET } from "./route";

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/admin/conversion-failures${query}`);
}

function orderByOfLastCall(): string | undefined {
  const calls = vi.mocked(listFailurePatterns).mock.calls;
  return calls[calls.length - 1]?.[0]?.orderBy;
}

describe("GET /api/admin/conversion-failures: ordering", () => {
  beforeEach(() => {
    state.adminConfigured = true;
    state.admin = true;
    vi.mocked(listFailurePatterns).mockClear();
  });

  it("defaults to recency", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    expect(orderByOfLastCall()).toBe("lastSeenAt");
    expect((await response.json()).sort).toBe("recent");
  });

  it("orders by occurrence count when asked", async () => {
    const response = await GET(makeRequest("?sort=frequent"));
    expect(orderByOfLastCall()).toBe("occurrenceCount");
    expect((await response.json()).sort).toBe("frequent");
  });

  it("falls back to the default for an unrecognized sort rather than refusing the page", async () => {
    const response = await GET(makeRequest("?sort=whatever"));
    expect(response.status).toBe(200);
    expect(orderByOfLastCall()).toBe("lastSeenAt");
    // Echoed, so a client that asked for something else can tell.
    expect((await response.json()).sort).toBe("recent");
  });

  it("keeps the filters while sorting", async () => {
    await GET(makeRequest("?sort=frequent&status=open&failureCategory=unmapped_character"));
    expect(listFailurePatterns).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: "occurrenceCount",
        status: "open",
        failureCategory: "unmapped_character",
      }),
    );
  });
});

describe("GET /api/admin/conversion-failures: access", () => {
  beforeEach(() => {
    state.adminConfigured = true;
    state.admin = true;
    vi.mocked(listFailurePatterns).mockClear();
  });

  it("is still admin-gated with the new parameter", async () => {
    state.admin = false;
    const response = await GET(makeRequest("?sort=frequent"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(listFailurePatterns).not.toHaveBeenCalled();
  });

  it("refuses before touching Firestore when the backend is unconfigured", async () => {
    state.adminConfigured = false;
    const response = await GET(makeRequest("?sort=frequent"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(listFailurePatterns).not.toHaveBeenCalled();
  });
});
