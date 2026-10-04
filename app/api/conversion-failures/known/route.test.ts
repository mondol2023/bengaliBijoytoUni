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
  getFailurePatternStatuses: vi.fn(),
  listFailurePatterns: vi.fn(),
  listResolutionsForEncoding: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getServerUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/security/sharedRateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/sharedRateLimit")>();
  return { ...actual, checkSharedRateLimit: vi.fn(async () => ({ ok: true })) };
});

import {
  getFailurePatternStatuses,
  listFailurePatterns,
  listResolutionsForEncoding,
} from "@/lib/firebase/conversionFailures";
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
    vi.mocked(getFailurePatternStatuses).mockReset();
    vi.mocked(getFailurePatternStatuses).mockResolvedValue(new Map([["pattern-abc", "open"]]));
    vi.mocked(listResolutionsForEncoding).mockReset();
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([]);
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
    vi.mocked(getFailurePatternStatuses).mockReset();
    vi.mocked(getFailurePatternStatuses).mockResolvedValue(new Map([["pattern-abc", "open"]]));
    vi.mocked(listResolutionsForEncoding).mockReset();
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([]);
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
    vi.mocked(getFailurePatternStatuses).mockReset();
    vi.mocked(getFailurePatternStatuses).mockResolvedValue(new Map([["pattern-abc", "open"]]));
    vi.mocked(listResolutionsForEncoding).mockReset();
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([]);
    vi.mocked(listFailurePatterns).mockRejectedValue(new Error("firestore is down"));
    const response = await GET(makeRequest(`?encodingId=${nextEncodingId()}`));
    expect(response.status).toBeGreaterThanOrEqual(500);
    // The underlying message is server-only and must not reach the client.
    expect(JSON.stringify(await response.json())).not.toContain("firestore is down");
  });
});

/**
 * The Phase 4 half of the payload. The selection rules themselves are tested
 * in `lib/conversionFailures/__tests__/knownResolutions.test.ts`; what is
 * tested here is that the route applies them, that the ETag covers them, and
 * that the per-instance cache is not keyed so coarsely that flipping the
 * flag serves the wrong answer for a minute.
 */
function storedResolution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "resolution-1",
    patternId: "pattern-abc",
    encodingId: "bijoy",
    failedSequence: "Av",
    lookupKey: "lookup-1",
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: "v1",
    engineVersion: "1.0.0",
    rulesHash: "rules-abc",
    candidateConversion: "আ",
    reasoningSummary: null,
    confidence: "high" as const,
    alternativeCandidates: [],
    isCertain: true,
    rawResponse: null,
    hitCount: 9_412,
    lastUsedAt: "2026-09-01T00:00:00.000Z",
    status: "reviewed" as const,
    reviewDecision: "accepted" as const,
    reviewedBy: "admin-1",
    reviewedAt: "2026-09-01T00:00:00.000Z",
    reviewNote: "Checked against a printed circular.",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("GET /api/conversion-failures/known: resolutions", () => {
  // A distinct `limit` per test, since the route's cache is keyed on it and
  // these all have to use the one encoding id the rule tables know.
  let limitCounter = 100;
  function nextLimit(): number {
    limitCounter += 1;
    return limitCounter;
  }

  beforeEach(() => {
    state.adminConfigured = true;
    vi.mocked(listFailurePatterns).mockReset();
    vi.mocked(listFailurePatterns).mockResolvedValue([]);
    vi.mocked(getFailurePatternStatuses).mockReset();
    vi.mocked(getFailurePatternStatuses).mockResolvedValue(new Map([["pattern-abc", "open"]]));
    vi.mocked(listResolutionsForEncoding).mockReset();
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([]);
    vi.unstubAllEnvs();
  });

  it("publishes an accepted resolution, and nothing else about it", async () => {
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([storedResolution()] as never);

    const response = await GET(makeRequest(`?encodingId=bijoy&limit=${nextLimit()}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resolutions).toHaveLength(1);
    expect(body.resolutions[0]).toStrictEqual({
      failedSequence: "Av",
      candidateConversion: "আ",
      verification: "accepted",
      label: null,
      engineVersion: "1.0.0",
    });
    // The ranking number, the reviewer and the note are all server-side.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("9412");
    expect(raw).not.toContain("admin-1");
    expect(raw).not.toContain("printed circular");
  });

  it("withholds an unreviewed resolution while the flag is off", async () => {
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([
      storedResolution({ status: "completed", reviewDecision: null }),
    ] as never);

    const response = await GET(makeRequest(`?encodingId=bijoy&limit=${nextLimit()}`));

    expect((await response.json()).resolutions).toHaveLength(0);
  });

  it("serves and labels an unreviewed resolution when the flag is on", async () => {
    vi.stubEnv("SERVE_UNVERIFIED_AI", "true");
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([
      storedResolution({ status: "completed", reviewDecision: null }),
    ] as never);

    const response = await GET(makeRequest(`?encodingId=bijoy&limit=${nextLimit()}`));
    const [entry] = (await response.json()).resolutions;

    expect(entry.verification).toBe("unverified");
    expect(entry.label.en).toContain("unverified");
    expect(entry.label.bn.length).toBeGreaterThan(0);
  });

  it("keys the snapshot cache on the flag, so flipping it is not masked", async () => {
    const limit = nextLimit();
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([
      storedResolution({ status: "completed", reviewDecision: null }),
    ] as never);

    const off = await GET(makeRequest(`?encodingId=bijoy&limit=${limit}`));
    expect((await off.json()).resolutions).toHaveLength(0);

    vi.stubEnv("SERVE_UNVERIFIED_AI", "true");
    const on = await GET(makeRequest(`?encodingId=bijoy&limit=${limit}`));
    expect((await on.json()).resolutions).toHaveLength(1);
  });

  it("re-runs the validator, so an accepted answer that went stale is withheld", async () => {
    // Nothing about the stored document changed; the answer is simply not a
    // valid conversion any more.
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([
      storedResolution({ candidateConversion: "Av" }),
    ] as never);

    const response = await GET(makeRequest(`?encodingId=bijoy&limit=${nextLimit()}`));

    expect((await response.json()).resolutions).toHaveLength(0);
  });

  it("covers the resolutions in the ETag", async () => {
    const limit = nextLimit();
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([] as never);
    const first = await GET(makeRequest(`?encodingId=bijoy&limit=${limit}`));
    const firstEtag = first.headers.get("etag");

    vi.mocked(listResolutionsForEncoding).mockResolvedValue([storedResolution()] as never);
    const second = await GET(makeRequest(`?encodingId=bijoy&limit=${nextLimit()}`));

    expect(firstEtag).not.toBeNull();
    expect(second.headers.get("etag")).not.toBe(firstEtag);
  });

  it("returns an empty array, not a missing field, with no backend configured", async () => {
    state.adminConfigured = false;

    const response = await GET(makeRequest(`?encodingId=bijoy&limit=${nextLimit()}`));

    expect((await response.json()).resolutions).toStrictEqual([]);
    expect(listResolutionsForEncoding).not.toHaveBeenCalled();
  });
});

/**
 * Finding 2 / open question 3, at the route: the status is the only input
 * that changes between the two builds, and nothing is written in between.
 */
describe("GET /api/conversion-failures/known: publication follows current status", () => {
  beforeEach(() => {
    state.adminConfigured = true;
    vi.mocked(listFailurePatterns).mockReset();
    vi.mocked(listResolutionsForEncoding).mockReset();
    vi.mocked(getFailurePatternStatuses).mockReset();
    vi.unstubAllEnvs();
  });

  it("publishes a pattern and its resolution while open, and neither once resolved", async () => {
    let status: "open" | "resolved" = "open";
    const resolution = storedResolution({ patternId: "pattern-abc" });
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([resolution] as never);
    vi.mocked(listFailurePatterns).mockImplementation(
      async () => [storedPattern({ id: "pattern-abc", status })] as never,
    );
    vi.mocked(getFailurePatternStatuses).mockImplementation(
      async () => new Map([["pattern-abc", status]]),
    );
    const resolutionBefore = JSON.stringify(resolution);

    const first = await (await GET(makeRequest("?encodingId=bijoy&limit=199"))).json();
    expect(first.patterns.map((p: { failedSequence: string }) => p.failedSequence)).toStrictEqual([
      "Av",
    ]);
    expect(first.resolutions).toHaveLength(1);

    // The only change: what the re-verification sweep would write.
    status = "resolved";

    // A second cache key, so this is a fresh build rather than the cached
    // first one (the per-instance cache captures its clock at construction,
    // so fake timers cannot age it). The read count below proves both were builds.
    const second = await (await GET(makeRequest("?encodingId=bijoy&limit=196"))).json();
    expect(second.patterns).toStrictEqual([]);
    expect(second.resolutions).toStrictEqual([]);

    // Nothing was written to the resolution to make that happen.
    expect(JSON.stringify(resolution)).toBe(resolutionBefore);
    expect(listFailurePatterns).toHaveBeenCalledTimes(2);
    expect(listResolutionsForEncoding).toHaveBeenCalledTimes(2);
  });

  it("withholds a resolution whose pattern no longer exists", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([]);
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([
      storedResolution({ patternId: "pattern-expired" }),
    ] as never);
    vi.mocked(getFailurePatternStatuses).mockResolvedValue(new Map());

    const body = await (await GET(makeRequest("?encodingId=bijoy&limit=198"))).json();
    expect(body.resolutions).toStrictEqual([]);
  });

  it("asks for the provenance pattern of every stored resolution", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([]);
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([
      storedResolution({ patternId: "p-1" }),
      storedResolution({ id: "resolution-2", patternId: "p-2", lookupKey: "lookup-2" }),
    ] as never);
    vi.mocked(getFailurePatternStatuses).mockResolvedValue(new Map());

    await GET(makeRequest("?encodingId=bijoy&limit=197"));
    expect(getFailurePatternStatuses).toHaveBeenCalledWith(["p-1", "p-2"]);
  });
});

describe("GET /api/conversion-failures/known: build log line", () => {
  beforeEach(() => {
    state.adminConfigured = true;
    vi.mocked(listFailurePatterns).mockReset();
    vi.mocked(listFailurePatterns).mockResolvedValue([]);
    vi.mocked(getFailurePatternStatuses).mockReset();
    vi.mocked(getFailurePatternStatuses).mockResolvedValue(new Map([["pattern-abc", "open"]]));
    vi.mocked(listResolutionsForEncoding).mockReset();
    vi.unstubAllEnvs();
  });

  function builtLines(spy: { mock: { calls: unknown[][] } }) {
    return spy.mock.calls
      .map(([line]) => line)
      .filter((line): line is string => typeof line === "string" && line.includes("known_snapshot_built"))
      .map((line) => JSON.parse(line));
  }

  it("emits one line per build, counting an unverified entry it published, and none on a cache hit", async () => {
    vi.stubEnv("SERVE_UNVERIFIED_AI", "true");
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([
      storedResolution(),
      storedResolution({ id: "resolution-2", lookupKey: "lookup-2", status: "completed", reviewDecision: null }),
    ] as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await GET(makeRequest("?encodingId=bijoy&limit=181"));
    await GET(makeRequest("?encodingId=bijoy&limit=181"));

    const lines = builtLines(log);
    expect(lines).toStrictEqual([
      expect.objectContaining({
        metric: "known_snapshot_built",
        encodingId: "bijoy",
        serveUnverified: true,
        resolutionsAccepted: 1,
        resolutionsUnverified: 1,
      }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("আ");
    log.mockRestore();
  });
});
