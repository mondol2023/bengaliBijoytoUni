/**
 * The Firestore counter store, against an in-memory double of the Admin SDK.
 * What matters: the ceiling is checked inside the transaction, a refusal
 * writes nothing, an admission writes `FieldValue.increment(1)` plus the
 * TTL stamp, and a release never takes the count below zero.
 *
 * No real Firestore project is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { increment: (by: number) => ({ __increment: by }) },
}));
vi.mock("../admin", () => ({ getAdminDb: vi.fn() }));

import { getAdminDb } from "../admin";
import { firestoreCounterStore, SHARED_COUNTER_COLLECTIONS } from "../sharedCounter";
import { __resetWriteMetricsForTests, getWriteMetricsSnapshot } from "../writeMetrics";

interface Increment {
  __increment: number;
}
const isIncrement = (value: unknown): value is Increment =>
  typeof value === "object" && value !== null && "__increment" in value;

function apply(existing: Record<string, unknown>, patch: Record<string, unknown>) {
  const next = { ...existing };
  for (const [field, value] of Object.entries(patch)) {
    next[field] = isIncrement(value) ? ((existing[field] as number | undefined) ?? 0) + value.__increment : value;
  }
  return next;
}

function createMockDb() {
  const store = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  const ref = (path: string) => ({
    path,
    async get() {
      const data = store.get(path);
      return { exists: data !== undefined, data: () => data };
    },
  });
  type Ref = ReturnType<typeof ref>;
  return {
    store,
    writes,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn({
        get: (r: Ref) => r.get(),
        set: (r: Ref, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          writes.push(`set ${r.path}`);
          store.set(r.path, options?.merge ? apply(store.get(r.path) ?? {}, data) : data);
        },
        update: (r: Ref, patch: Record<string, unknown>) => {
          writes.push(`update ${r.path}`);
          store.set(r.path, apply(store.get(r.path) ?? {}, patch));
        },
      });
    },
  };
}

const EXPIRE = new Date("2026-10-05T00:00:00.000Z");
const slot = (limit: number) => ({ collection: "aiCallBudget", docId: "abc_1", limit, expireAt: EXPIRE });

let db: ReturnType<typeof createMockDb>;

beforeEach(() => {
  db = createMockDb();
  vi.mocked(getAdminDb).mockReturnValue(db as unknown as ReturnType<typeof getAdminDb>);
  __resetWriteMetricsForTests();
});

describe("firestoreCounterStore.reserve", () => {
  it("admits up to the limit, then refuses", async () => {
    expect(await firestoreCounterStore.reserve(slot(2))).toStrictEqual({ admitted: true, count: 1 });
    expect(await firestoreCounterStore.reserve(slot(2))).toStrictEqual({ admitted: true, count: 2 });
    expect(await firestoreCounterStore.reserve(slot(2))).toStrictEqual({ admitted: false, count: 2 });
  });

  it("writes the count with FieldValue.increment and stamps expireAt as a Date", async () => {
    await firestoreCounterStore.reserve(slot(5));
    expect(db.store.get("aiCallBudget/abc_1")).toStrictEqual({ count: 1, expireAt: EXPIRE });
  });

  it("writes nothing when it refuses", async () => {
    await firestoreCounterStore.reserve(slot(1));
    db.writes.length = 0;
    await firestoreCounterStore.reserve(slot(1));
    expect(db.writes).toStrictEqual([]);
  });

  it("counts admitted writes in the write metrics, and not refusals", async () => {
    await firestoreCounterStore.reserve(slot(1));
    await firestoreCounterStore.reserve(slot(1));
    expect(getWriteMetricsSnapshot().processTotal).toBe(1);
  });

  it("treats a malformed stored count as zero rather than throwing", async () => {
    db.store.set("aiCallBudget/abc_1", { count: "lots" });
    expect((await firestoreCounterStore.reserve(slot(1))).admitted).toBe(true);
  });
});

describe("firestoreCounterStore.release and read", () => {
  it("gives a unit back", async () => {
    await firestoreCounterStore.reserve(slot(1));
    await firestoreCounterStore.release(slot(1));
    expect(await firestoreCounterStore.read(slot(1))).toBe(0);
    expect((await firestoreCounterStore.reserve(slot(1))).admitted).toBe(true);
  });

  it("never goes below zero, and writes nothing when already at zero", async () => {
    await firestoreCounterStore.release(slot(1));
    expect(db.writes).toStrictEqual([]);
    expect(await firestoreCounterStore.read(slot(1))).toBe(0);
  });
});

describe("which collections a counter may touch", () => {
  it("refuses any collection that is not a counter, before reaching Firestore", async () => {
    for (const collection of ["aiResolutions", "conversionFailures", "failurePatterns"]) {
      const target = { collection, docId: "x", limit: 1, expireAt: EXPIRE };
      await expect(firestoreCounterStore.reserve(target)).rejects.toThrow(/not a shared counter/);
      await expect(firestoreCounterStore.release(target)).rejects.toThrow(/not a shared counter/);
      await expect(firestoreCounterStore.read(target)).rejects.toThrow(/not a shared counter/);
    }
    expect(db.writes).toStrictEqual([]);
  });

  it("names no evidence or resolution collection as a counter", () => {
    for (const forbidden of ["aiResolutions", "conversionFailures", "failurePatterns"]) {
      expect(SHARED_COUNTER_COLLECTIONS.has(forbidden)).toBe(false);
    }
  });
});
