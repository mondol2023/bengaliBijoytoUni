/**
 * `anonymousN` numbering. The property that matters is that two first
 * sightings racing each other — on two Vercel instances — never get the same
 * number, and that one visitor never gets two. The fake below models what the
 * code relies on: a transaction whose reads went stale before it committed is
 * thrown away and re-run (see `conversionFailures.concurrency.test.ts` for the
 * fuller version of this model and what it does not cover).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../admin", () => ({ getAdminDb: vi.fn() }));

import { getAdminDb } from "../admin";
import { anonymousLabelFor, anonymousVisitorKey, resolveAnonymousLabel } from "../anonymousVisitors";

type Data = Record<string, unknown>;

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createDb() {
  const store = new Map<string, Data>();
  const versions = new Map<string, number>();
  const stats = { commits: 0, transactions: 0 };
  type Ref = { id: string; path: string; get: () => Promise<{ exists: boolean; data: () => Data | undefined }> };

  function ref(collection: string, id: string): Ref {
    const path = `${collection}/${id}`;
    return {
      id,
      path,
      async get() {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
    };
  }

  return {
    store,
    stats,
    collection: (name: string) => ({ doc: (id: string) => ref(name, id) }),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      stats.transactions++;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const read = new Map<string, number>();
        const writes: Array<[string, Data]> = [];
        const tx = {
          async get(r: Ref) {
            const data = store.get(r.path);
            read.set(r.path, versions.get(r.path) ?? 0);
            await yieldTurn();
            return { exists: data !== undefined, data: () => data };
          },
          set(r: Ref, data: Data) {
            writes.push([r.path, data]);
          },
        };
        const result = await fn(tx);
        if ([...read].some(([path, v]) => (versions.get(path) ?? 0) !== v)) continue;
        for (const [path, data] of writes) {
          store.set(path, { ...data });
          versions.set(path, (versions.get(path) ?? 0) + 1);
        }
        stats.commits++;
        return result;
      }
      throw new Error("ABORTED: too much contention");
    },
  };
}

const visitor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("resolveAnonymousLabel", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb();
    vi.mocked(getAdminDb).mockReturnValue(db as never);
  });

  it("numbers visitors in the order they are first seen", async () => {
    expect(await resolveAnonymousLabel(visitor(1))).toBe("anonymous1");
    expect(await resolveAnonymousLabel(visitor(2))).toBe("anonymous2");
    expect(await resolveAnonymousLabel(visitor(3))).toBe("anonymous3");
  });

  it("gives a returning visitor the same label without a transaction", async () => {
    await resolveAnonymousLabel(visitor(1));
    const before = db.stats.transactions;
    expect(await resolveAnonymousLabel(visitor(1))).toBe("anonymous1");
    expect(db.stats.transactions).toBe(before);
  });

  it("stores only a hash of the visitor id, never the id itself", async () => {
    await resolveAnonymousLabel(visitor(1));
    const dump = JSON.stringify([...db.store]);
    expect(dump).not.toContain(visitor(1));
    expect(db.store.has(`anonymousVisitors/${anonymousVisitorKey(visitor(1))}`)).toBe(true);
  });

  it("never hands two concurrent new visitors the same number", async () => {
    const labels = await Promise.all([1, 2, 3, 4].map((n) => resolveAnonymousLabel(visitor(n))));
    expect(new Set(labels).size).toBe(4);
    expect([...labels].sort()).toEqual(["anonymous1", "anonymous2", "anonymous3", "anonymous4"]);
  });

  it("never gives one visitor two numbers when its first reports race", async () => {
    const labels = await Promise.all([1, 1, 1].map((n) => resolveAnonymousLabel(visitor(n))));
    expect(new Set(labels)).toEqual(new Set(["anonymous1"]));
    expect(await resolveAnonymousLabel(visitor(2))).toBe("anonymous2");
  });
});

describe("anonymousLabelFor", () => {
  it("formats the label", () => {
    expect(anonymousLabelFor(1)).toBe("anonymous1");
    expect(anonymousLabelFor(42)).toBe("anonymous42");
  });
});
