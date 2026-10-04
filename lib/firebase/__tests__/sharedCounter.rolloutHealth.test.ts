/**
 * Rollout health for the shared counters, through the real
 * `firestoreCounterStore` rather than a stand-in store.
 *
 * `sharedCounter.test.ts` proves the store's arithmetic against a
 * transaction double that runs callers one at a time. Production does not:
 * Vercel instances race, and Firestore resolves the race by retrying the
 * losing transaction. The double here does the same — optimistic, versioned,
 * retried — so "N instances at once take exactly the limit" is tested the
 * way it actually happens. It also covers the two failure paths the rollout
 * depends on, end to end through the real callers: the AI budget must fail
 * closed, the rate limiter must fall back to its per-instance bound, and
 * neither may log the caller it was counting.
 *
 * No real Firestore project is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { increment: (by: number) => ({ __increment: by }) },
}));
vi.mock("../admin", () => ({ getAdminDb: vi.fn() }));

import { getAdminDb } from "../admin";
import { firestoreCounterStore } from "../sharedCounter";
import { __resetWriteMetricsForTests, getWriteMetricsSnapshot } from "../writeMetrics";
import { AI_CALL_BUDGET_COLLECTION, createDailyCallBudget } from "@/lib/ai/costCap";
import { RATE_LIMIT_COLLECTION, checkSharedRateLimit, windowDocId } from "@/lib/security/sharedRateLimit";

interface Doc {
  data: Record<string, unknown>;
  version: number;
}

class Aborted extends Error {}

/**
 * Optimistic transactions: reads record the version they saw, the commit
 * fails if any of those documents moved since, and the whole callback is
 * retried — Firestore's server-side contract, up to its default attempt
 * count. `await` points between read and commit let concurrent callers
 * interleave, which is the point.
 */
function createContendedDb(options: { failWith?: Error; maxAttempts?: number } = {}) {
  const docs = new Map<string, Doc>();
  let retries = 0;
  const maxAttempts = options.maxAttempts ?? 5;

  const apply = (existing: Record<string, unknown>, patch: Record<string, unknown>) => {
    const next = { ...existing };
    for (const [field, value] of Object.entries(patch)) {
      const inc = value as { __increment?: number };
      next[field] =
        typeof value === "object" && value !== null && "__increment" in inc
          ? ((existing[field] as number | undefined) ?? 0) + (inc.__increment ?? 0)
          : value;
    }
    return next;
  };

  const db = {
    docs,
    retries: () => retries,
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      if (options.failWith) throw options.failWith;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const seen = new Map<string, number>();
        const writes: { path: string; patch: Record<string, unknown> }[] = [];
        const tx = {
          async get(ref: { path: string }) {
            await Promise.resolve();
            const doc = docs.get(ref.path);
            seen.set(ref.path, doc?.version ?? 0);
            return { exists: doc !== undefined, data: () => doc?.data };
          },
          set(ref: { path: string }, patch: Record<string, unknown>) {
            writes.push({ path: ref.path, patch });
          },
          update(ref: { path: string }, patch: Record<string, unknown>) {
            writes.push({ path: ref.path, patch });
          },
        };
        const result = await fn(tx);
        await Promise.resolve();
        const conflicted = [...seen].some(([path, version]) => (docs.get(path)?.version ?? 0) !== version);
        if (conflicted) {
          retries += 1;
          continue;
        }
        for (const { path, patch } of writes) {
          const current = docs.get(path);
          docs.set(path, { data: apply(current?.data ?? {}, patch), version: (current?.version ?? 0) + 1 });
        }
        return result;
      }
      throw new Aborted("ABORTED: too much contention");
    },
  };
  return db;
}

function useDb(db: ReturnType<typeof createContendedDb>) {
  vi.mocked(getAdminDb).mockReturnValue(db as unknown as ReturnType<typeof getAdminDb>);
}

beforeEach(() => {
  __resetWriteMetricsForTests();
  vi.restoreAllMocks();
});

describe("concurrent increments", () => {
  it("admits exactly the limit when many instances reserve at once, and stores that count", async () => {
    const db = createContendedDb({ maxAttempts: 20 });
    useDb(db);
    const slot = { collection: AI_CALL_BUDGET_COLLECTION, docId: "2026-10-04", limit: 3, expireAt: new Date(0) };

    const outcomes = await Promise.all(Array.from({ length: 8 }, () => firestoreCounterStore.reserve(slot)));

    expect(outcomes.filter((o) => o.admitted)).toHaveLength(3);
    expect(db.docs.get("aiCallBudget/2026-10-04")?.data.count).toBe(3);
    // The race was real: some transactions lost and were retried.
    expect(db.retries()).toBeGreaterThan(0);
    // Only committed admissions are counted as writes.
    expect(getWriteMetricsSnapshot().processTotal).toBe(3);
  });

  it("surfaces contention it cannot resolve as an error, not as an admission", async () => {
    const db = createContendedDb({ maxAttempts: 1 });
    useDb(db);
    const slot = { collection: RATE_LIMIT_COLLECTION, docId: "w_0", limit: 100, expireAt: new Date(0) };

    const settled = await Promise.allSettled(Array.from({ length: 4 }, () => firestoreCounterStore.reserve(slot)));

    const admitted = settled.filter((s) => s.status === "fulfilled" && s.value.admitted).length;
    const rejected = settled.filter((s) => s.status === "rejected").length;
    expect(admitted + rejected).toBe(4);
    expect(rejected).toBeGreaterThan(0);
    expect(db.docs.get("rateLimitWindows/w_0")?.data.count).toBe(admitted);
  });
});

describe("transaction failure", () => {
  it("propagates from the store and records no write", async () => {
    useDb(createContendedDb({ failWith: new Error("UNAVAILABLE: firestore down") }));
    const slot = { collection: AI_CALL_BUDGET_COLLECTION, docId: "2026-10-04", limit: 3, expireAt: new Date(0) };

    await expect(firestoreCounterStore.reserve(slot)).rejects.toThrow("UNAVAILABLE");
    expect(getWriteMetricsSnapshot().processTotal).toBe(0);
  });

  it("makes the AI budget refuse as unavailable — fails closed, never unlimited", async () => {
    useDb(createContendedDb({ failWith: new Error("UNAVAILABLE: firestore down") }));
    const budget = createDailyCallBudget({ maxCallsPerDay: () => 100, store: firestoreCounterStore });

    const reservation = await budget.reserve();

    expect(reservation.ok).toBe(false);
    if (reservation.ok) return;
    expect(reservation.error.code).toBe("provider_budget_unavailable");
  });

  it("makes the rate limiter fall back to its per-instance verdict, and log without the caller's IP", async () => {
    useDb(createContendedDb({ failWith: new Error("UNAVAILABLE: firestore down") }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const key = `known-patterns:ip:${ip}:${Math.random()}`;

    const result = await checkSharedRateLimit(
      { key, limit: 5, windowMs: 60_000 },
      { store: firestoreCounterStore, now: Date.now },
    );

    expect(result.ok).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    const logged = JSON.stringify(consoleError.mock.calls, (_k, value) =>
      value instanceof Error ? value.message : value,
    );
    expect(logged).toContain("Shared rate-limit check failed");
    expect(logged).not.toContain(ip);
  });
});

describe("UTC window and day keys, and expiry stamps", () => {
  it("writes the AI budget to the UTC day's document, expiring 35 days after the reservation", async () => {
    const db = createContendedDb();
    useDb(db);
    const at = new Date("2026-10-04T23:59:59.999Z");
    await createDailyCallBudget({ maxCallsPerDay: () => 5, now: () => at, store: firestoreCounterStore }).reserve();

    const doc = db.docs.get("aiCallBudget/2026-10-04");
    expect(doc?.data.count).toBe(1);
    expect(doc?.data.expireAt).toBeInstanceOf(Date);
    expect((doc?.data.expireAt as Date).toISOString()).toBe("2026-11-08T23:59:59.999Z");
  });

  it("moves to a new budget document one millisecond later, at midnight UTC", async () => {
    const db = createContendedDb();
    useDb(db);
    const midnight = new Date("2026-10-05T00:00:00.000Z");
    await createDailyCallBudget({ maxCallsPerDay: () => 5, now: () => midnight, store: firestoreCounterStore }).reserve();

    expect([...db.docs.keys()]).toStrictEqual(["aiCallBudget/2026-10-05"]);
  });

  it("writes a rate-limit window to its aligned document, expiring when the window ends", async () => {
    const db = createContendedDb();
    useDb(db);
    const windowMs = 5 * 60_000;
    const now = Date.UTC(2026, 9, 4, 12, 3, 17);
    const windowStart = Date.UTC(2026, 9, 4, 12, 0, 0);
    const key = `test:${Math.random()}`;

    await checkSharedRateLimit({ key, limit: 5, windowMs }, { store: firestoreCounterStore, now: () => now });

    const doc = db.docs.get(`rateLimitWindows/${windowDocId(key, windowStart)}`);
    expect(doc?.data.count).toBe(1);
    expect((doc?.data.expireAt as Date).getTime()).toBe(windowStart + windowMs);
  });
});
