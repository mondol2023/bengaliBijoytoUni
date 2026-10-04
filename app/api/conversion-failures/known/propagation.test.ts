import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  KNOWN_PATTERNS_FRESH_MS,
  KNOWN_PATTERNS_RETAIN_MS,
} from "@/lib/conversionFailures/knownPatternsClient";

/**
 * Every duration the rollout docs derive a propagation window from
 * (`docs/rollout-canary-and-rollback.md` §Timing). The window is arithmetic
 * over these numbers, so each is pinned here: change one and this file
 * fails, and the failure message names the doc that has to change with it.
 *
 * The four layers between a server-side change and a reader's screen:
 *
 * 1. the per-instance snapshot cache in the route (60 s),
 * 2. the HTTP response's `Cache-Control` (60 s fresh + 300 s stale),
 * 3. the browser's localStorage copy (10 min fresh, 60 min kept as the
 *    answer to any failed revalidation),
 * 4. an open tab, which fetches once per encoding and never again.
 */
const DOC = "docs/rollout-canary-and-rollback.md §Timing";

vi.mock("@/lib/firebase/admin", () => ({ isFirebaseAdminConfigured: true }));

vi.mock("@/lib/firebase/conversionFailures", () => ({
  getFailurePatternStatuses: vi.fn(async () => new Map()),
  listFailurePatterns: vi.fn(async () => []),
  listResolutionsForEncoding: vi.fn(async () => []),
}));

vi.mock("@/lib/auth/session", () => ({
  getServerUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/security/sharedRateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/sharedRateLimit")>();
  return { ...actual, checkSharedRateLimit: vi.fn(async () => ({ ok: true })) };
});

import { listFailurePatterns } from "@/lib/firebase/conversionFailures";

function makeRequest(encodingId: string): NextRequest {
  return new NextRequest(`http://localhost/api/conversion-failures/known?encodingId=${encodingId}`);
}

/**
 * The route's cache captures `Date.now` when the module is evaluated, so the
 * clock is faked first and the route imported fresh after it.
 */
async function freshRoute() {
  vi.resetModules();
  return import("./route");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T00:00:00.000Z"));
  vi.mocked(listFailurePatterns).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("propagation inputs the rollout docs depend on", () => {
  it("HTTP: 60 s fresh, 300 s stale-while-revalidate", async () => {
    const { GET } = await freshRoute();
    const response = await GET(makeRequest("bijoy"));
    expect(response.headers.get("cache-control"), DOC).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });

  it("instance cache: a build is reused for 60 s and rebuilt after", async () => {
    const { GET } = await freshRoute();
    await GET(makeRequest("bijoy"));
    expect(listFailurePatterns).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-04T00:00:59.999Z"));
    await GET(makeRequest("bijoy"));
    expect(listFailurePatterns, DOC).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-04T00:01:00.001Z"));
    await GET(makeRequest("bijoy"));
    expect(listFailurePatterns, DOC).toHaveBeenCalledTimes(2);
  });

  it("a new deployment starts with an empty instance cache", async () => {
    // Why a server-side rollback (Rollback B) is not delayed by layer 1: a
    // redeploy is new instances, and a new module has nothing cached.
    let { GET } = await freshRoute();
    await GET(makeRequest("bijoy"));
    ({ GET } = await freshRoute());
    await GET(makeRequest("bijoy"));
    expect(listFailurePatterns).toHaveBeenCalledTimes(2);
  });

  it("browser: 10 min fresh, kept 60 min as the fallback for a failed revalidation", () => {
    expect(KNOWN_PATTERNS_FRESH_MS, DOC).toBe(10 * 60 * 1000);
    expect(KNOWN_PATTERNS_RETAIN_MS, DOC).toBe(60 * 60 * 1000);
  });
});
