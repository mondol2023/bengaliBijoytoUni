import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The read half of the privacy bound. The POST beside this one proves no
 * whole-document field reaches Firestore; this proves no stored field leaves
 * it. Plus the ETag contract, which is the entire point of the endpoint:
 * without a working 304 the client re-downloads the snapshot on every load.
 */
const state = vi.hoisted(() => ({ adminConfigured: true }));

vi.mock("@/lib/firebase/admin", () => ({
  get isFirebaseAdminConfigured() {
    return state.adminConfigured;
  },
}));

vi.mock("@/lib/firebase/conversionFailures", () => ({
  listFailurePatterns: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getServerUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/security/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  getRequestIp: vi.fn(() => "127.0.0.1"),
}));

import { listFailurePatterns } from "@/lib/firebase/conversionFailures";
import { GET } from "./route";

/** A stored pattern, with every field the public payload must not carry. */
function storedPattern(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pattern-abc",
    encodingId: "bijoy",
    engineVersion: "1.0.0",
    failedSequence: "Av",
    failureCategory: "unmapped_character" as const,
    occurrenceCount: 412,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    sampleOccurrenceIds: ["occurrence-1", "occurrence-2"],
    status: "open" as const,
    ...overrides,
  };
}

/** A distinct encoding id per test keeps the route's per-instance cache out of the way. */
let encodingCounter = 0;
function nextEncodingId(): string {
  encodingCounter += 1;
  return `bijoy-${encodingCounter}`;
}

function makeRequest(query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/conversion-failures/known${query}`, { headers });
}

describe("GET /api/conversion-failures/known", () => {
  beforeEach(() => {
    state.adminConfigured = true;
    vi.mocked(listFailurePatterns).mockReset();
    vi.mocked(listFailurePatterns).mockResolvedValue([storedPattern()] as never);
  });

  it("publishes exactly three fields per pattern", async () => {
    const response = await GET(makeRequest(`?encodingId=${nextEncodingId()}`));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.patterns).toHaveLength(1);
    expect(Object.keys(body.patterns[0]).sort()).toStrictEqual([
      "failedSequence",
      "failureCategory",
      "status",
    ]);
  });

  it("leaks no count, no timestamp and no occurrence id anywhere in the body", async () => {
    const response = await GET(makeRequest(`?encodingId=${nextEncodingId()}`));
    const raw = JSON.stringify(await response.json());

    // Asserted against the serialized body, not the parsed object: a nested
    // field, a renamed field, or a stray spread would all still show up here.
    expect(raw).not.toContain("412");
    expect(raw).not.toContain("occurrence-1");
    expect(raw).not.toContain("sampleOccurrenceIds");
    expect(raw).not.toContain("lastSeenAt");
    expect(raw).not.toContain("firstSeenAt");
    expect(raw).not.toContain("occurrenceCount");
  });

  it("orders by occurrence count, not by recency", async () => {
    const encodingId = nextEncodingId();
    await GET(makeRequest(`?encodingId=${encodingId}`));
    expect(listFailurePatterns).toHaveBeenCalledWith(
      expect.objectContaining({ encodingId, orderBy: "occurrenceCount" }),
    );
  });

  it("requires an encodingId", async () => {
    const response = await GET(makeRequest(""));
    expect(response.status).toBe(400);
    expect(listFailurePatterns).not.toHaveBeenCalled();
  });

  it("rejects a limit outside the allowed range", async () => {
    for (const limit of ["0", "-1", "1000", "abc", "1.5"]) {
      const response = await GET(makeRequest(`?encodingId=${nextEncodingId()}&limit=${limit}`));
      expect(response.status, `limit=${limit}`).toBe(400);
    }
    expect(listFailurePatterns).not.toHaveBeenCalled();
  });

  it("accepts a limit inside the range and passes it through", async () => {
    const encodingId = nextEncodingId();
    const response = await GET(makeRequest(`?encodingId=${encodingId}&limit=5`));
    expect(response.status).toBe(200);
    expect(listFailurePatterns).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });
});

describe("GET /api/conversion-failures/known: ETag", () => {
  beforeEach(() => {
    state.adminConfigured = true;
    vi.mocked(listFailurePatterns).mockReset();
    vi.mocked(listFailurePatterns).mockResolvedValue([storedPattern()] as never);
  });

  it("returns an ETag and a cache-control header", async () => {
    const response = await GET(makeRequest(`?encodingId=${nextEncodingId()}`));
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(response.headers.get("cache-control")).toContain("max-age=");
  });

  it("answers 304 with no body when the client already has that version", async () => {
    const encodingId = nextEncodingId();
    const first = await GET(makeRequest(`?encodingId=${encodingId}`));
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();

    const second = await GET(makeRequest(`?encodingId=${encodingId}`, { "If-None-Match": etag! }));
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("honors a weak validator and a list of candidates", async () => {
    const encodingId = nextEncodingId();
    const etag = (await GET(makeRequest(`?encodingId=${encodingId}`))).headers.get("etag")!;

    const weak = await GET(makeRequest(`?encodingId=${encodingId}`, { "If-None-Match": `W/${etag}` }));
    expect(weak.status).toBe(304);

    const list = await GET(
      makeRequest(`?encodingId=${encodingId}`, { "If-None-Match": `"other", ${etag}` }),
    );
    expect(list.status).toBe(304);

    const star = await GET(makeRequest(`?encodingId=${encodingId}`, { "If-None-Match": "*" }));
    expect(star.status).toBe(304);
  });

  it("returns a body when the client's validator is stale", async () => {
    const encodingId = nextEncodingId();
    await GET(makeRequest(`?encodingId=${encodingId}`));
    const response = await GET(
      makeRequest(`?encodingId=${encodingId}`, { "If-None-Match": '"0000000000000000"' }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).patterns).toHaveLength(1);
  });

  it("changes the ETag when the patterns change, and not when only the clock does", async () => {
    const encodingId = nextEncodingId();
    const first = await GET(makeRequest(`?encodingId=${encodingId}`));
    const firstEtag = first.headers.get("etag");

    // Same data, fresh build (a different encodingId would change the ETag
    // by itself, so the snapshot cache is bypassed via the limit instead).
    const sameData = await GET(makeRequest(`?encodingId=${encodingId}&limit=49`));
    expect(sameData.headers.get("etag")).toBe(firstEtag);

    vi.mocked(listFailurePatterns).mockResolvedValue([
      storedPattern({ failedSequence: "Kv" }),
    ] as never);
    const changed = await GET(makeRequest(`?encodingId=${encodingId}&limit=48`));
    expect(changed.headers.get("etag")).not.toBe(firstEtag);
  });
});

describe("GET /api/conversion-failures/known: degraded", () => {
  beforeEach(() => {
    vi.mocked(listFailurePatterns).mockReset();
  });

  it("returns an empty snapshot rather than an error when Firebase is unconfigured", async () => {
    state.adminConfigured = false;
    const response = await GET(makeRequest(`?encodingId=${nextEncodingId()}`));
    expect(response.status).toBe(200);
    expect((await response.json()).patterns).toStrictEqual([]);
    expect(listFailurePatterns).not.toHaveBeenCalled();
  });

  it("fails cleanly when the query throws", async () => {
    state.adminConfigured = true;
    vi.mocked(listFailurePatterns).mockRejectedValue(new Error("firestore is down"));
    const response = await GET(makeRequest(`?encodingId=${nextEncodingId()}`));
    expect(response.status).toBeGreaterThanOrEqual(500);
    // The underlying message is server-only and must not reach the client.
    expect(JSON.stringify(await response.json())).not.toContain("firestore is down");
  });
});
