/**
 * The shared rate limiter. The store is injected, so "another instance"
 * is simulated by reserving against the same store directly — which is
 * exactly what a second Vercel instance does to the Firestore document.
 * No real Firestore project is touched.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCounterStore, type CounterStore } from "../counterStore";
import { UNKNOWN_CLIENT_IP } from "../rateLimit";
import {
  RATE_LIMIT_COLLECTION,
  checkSharedRateLimit,
  rateLimitIdentity,
  windowDocId,
} from "../sharedRateLimit";

const WINDOW_MS = 5 * 60_000;
const NOW = Date.UTC(2026, 9, 4, 12, 1, 0); // 1 minute into a 5-minute window
const WINDOW_START = Math.floor(NOW / WINDOW_MS) * WINDOW_MS;

// The in-memory layer is module-global, so every test uses its own key.
let keySeq = 0;
const freshKey = () => `test:${++keySeq}:${Math.random()}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkSharedRateLimit", () => {
  it("refuses once other instances have used the shared window, though this instance has not", async () => {
    const store = createMemoryCounterStore();
    const key = freshKey();
    const slot = {
      collection: RATE_LIMIT_COLLECTION,
      docId: windowDocId(key, WINDOW_START),
      limit: 2,
      expireAt: new Date(WINDOW_START + WINDOW_MS),
    };
    // Two requests landed on two other instances.
    await store.reserve(slot);
    await store.reserve(slot);

    const result = await checkSharedRateLimit(
      { key, limit: 2, windowMs: WINDOW_MS },
      { store, now: () => NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RATE_LIMIT_ERROR");
    // Four minutes left in the aligned window.
    expect(result.error.details).toStrictEqual({ retryAfterSeconds: 240 });
  });

  it("admits up to the limit across the deployment", async () => {
    const store = createMemoryCounterStore();
    const key = freshKey();
    const deps = { store, now: () => NOW };
    const opts = { key, limit: 3, windowMs: WINDOW_MS };
    const results = await Promise.all([1, 2, 3, 4].map(() => checkSharedRateLimit(opts, deps)));
    expect(results.map((r) => r.ok)).toStrictEqual([true, true, true, false]);
  });

  it("starts a new shared window at the aligned boundary", async () => {
    const store = createMemoryCounterStore();
    const key = freshKey();
    const opts = { key, limit: 1, windowMs: WINDOW_MS };
    // The local layer reads `Date.now` itself and keys its window from first
    // use; pin it, then move past both windows so only the shared document
    // decides.
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect((await checkSharedRateLimit(opts, { store, now: () => NOW })).ok).toBe(true);
    clock.mockReturnValue(NOW + WINDOW_MS);
    const next = await checkSharedRateLimit(opts, { store, now: () => WINDOW_START + WINDOW_MS });
    expect(next.ok).toBe(true);
  });

  it("does not touch the shared store when the local layer already refused", async () => {
    const reserve = vi.fn(async () => ({ admitted: true as const, count: 1 }));
    const store: CounterStore = { reserve, release: async () => undefined, read: async () => 0 };
    const key = freshKey();
    const opts = { key, limit: 1, windowMs: WINDOW_MS };
    await checkSharedRateLimit(opts, { store, now: () => NOW });
    reserve.mockClear();
    const second = await checkSharedRateLimit(opts, { store, now: () => NOW });
    expect(second.ok).toBe(false);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("keeps a shared:false check per-instance", async () => {
    const reserve = vi.fn(async () => ({ admitted: false as const, count: 99 }));
    const store: CounterStore = { reserve, release: async () => undefined, read: async () => 0 };
    const result = await checkSharedRateLimit(
      { key: freshKey(), limit: 5, windowMs: WINDOW_MS, shared: false },
      { store, now: () => NOW },
    );
    expect(result.ok).toBe(true);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("uses the local verdict when there is no shared store (Firebase not configured)", async () => {
    const result = await checkSharedRateLimit(
      { key: freshKey(), limit: 5, windowMs: WINDOW_MS },
      { store: null, now: () => NOW },
    );
    expect(result.ok).toBe(true);
  });

  it("falls back to the local verdict, and logs, when Firestore fails — never to no limit", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store: CounterStore = {
      reserve: async () => {
        throw new Error("UNAVAILABLE");
      },
      release: async () => undefined,
      read: async () => 0,
    };
    const key = freshKey();
    const opts = { key, limit: 1, windowMs: WINDOW_MS };
    expect((await checkSharedRateLimit(opts, { store, now: () => NOW })).ok).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    // The per-instance bound still holds.
    expect((await checkSharedRateLimit(opts, { store, now: () => NOW })).ok).toBe(false);
  });

  it("stores a hash of the key, never the key itself", () => {
    const id = windowDocId("conversion-failures:ip:203.0.113.4", WINDOW_START);
    expect(id).not.toContain("203.0.113.4");
    expect(id).toMatch(/^[0-9a-f]{40}_\d+$/);
    expect(id).not.toContain("/");
  });
});

describe("rateLimitIdentity", () => {
  const request = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });

  it("uses the uid for a signed-in caller, shared", () => {
    expect(rateLimitIdentity(request({}), { uid: "u1" })).toStrictEqual({ id: "uid:u1", shared: true });
  });

  it("uses the IP for an anonymous caller, shared", () => {
    expect(rateLimitIdentity(request({ "x-forwarded-for": "203.0.113.4" }), null)).toStrictEqual({
      id: "ip:203.0.113.4",
      shared: true,
    });
  });

  it("never shares the unknown-IP bucket across instances", () => {
    expect(rateLimitIdentity(request({}), null)).toStrictEqual({
      id: `ip:${UNKNOWN_CLIENT_IP}`,
      shared: false,
    });
  });
});
