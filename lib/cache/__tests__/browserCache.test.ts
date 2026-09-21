import { describe, expect, it } from "vitest";
import { createBrowserCache } from "../browserCache";
import { cacheKey, cacheNamespace } from "../keys";

/**
 * A `Storage` good enough to test against, including the two behaviors that
 * actually matter and that a plain `Map` would hide: a quota that throws on
 * write, and an implementation that can be switched to throw on every
 * operation the way a site-data-blocked browser does.
 */
function fakeStorage(options: { maxItems?: number; throwOnEverything?: boolean } = {}): Storage & {
  raw: Map<string, string>;
} {
  const { maxItems = Infinity, throwOnEverything = false } = options;
  const raw = new Map<string, string>();
  const guard = () => {
    if (throwOnEverything) throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    raw,
    get length() {
      guard();
      return raw.size;
    },
    key(index: number) {
      guard();
      return [...raw.keys()][index] ?? null;
    },
    getItem(key: string) {
      guard();
      return raw.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      guard();
      if (!raw.has(key) && raw.size >= maxItems) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      raw.set(key, value);
    },
    removeItem(key: string) {
      guard();
      raw.delete(key);
    },
    clear() {
      guard();
      raw.clear();
    },
  } as Storage & { raw: Map<string, string> };
}

function testClock(start = 1_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => void (current += ms) };
}

const NAMESPACE = cacheNamespace({ name: "patterns", engineVersion: "1.0.0", rulesHash: "aaaa1111" });

describe("createBrowserCache: round trip", () => {
  it("stores and reads back through the injected storage", async () => {
    const storage = fakeStorage();
    const cache = createBrowserCache<{ n: number }>({ maxEntries: 10, namespace: NAMESPACE, storage });
    const key = cacheKey(NAMESPACE, "bijoy");

    await cache.set(key, { n: 1 });
    expect(await cache.get(key)).toStrictEqual({ n: 1 });
    expect(await cache.size()).toBe(1);

    await cache.delete(key);
    expect(await cache.get(key)).toBeUndefined();
  });

  it("clears only its own keys", async () => {
    const storage = fakeStorage();
    storage.setItem("some-other-app:setting", "keep me");
    const cache = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });

    await cache.set(cacheKey(NAMESPACE, "a"), "alpha");
    await cache.clear();

    expect(storage.getItem("some-other-app:setting")).toBe("keep me");
    expect(await cache.size()).toBe(0);
  });
});

describe("createBrowserCache: version invalidation", () => {
  it("prunes entries written under a superseded engine version", async () => {
    const storage = fakeStorage();
    const oldNamespace = cacheNamespace({ name: "patterns", engineVersion: "0.9.0", rulesHash: "aaaa1111" });
    const oldCache = createBrowserCache<string>({ maxEntries: 10, namespace: oldNamespace, storage });
    await oldCache.set(cacheKey(oldNamespace, "bijoy"), "stale output");
    expect(storage.raw.size).toBe(1);

    // Constructing the store for the new version is what prunes.
    const newCache = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });
    expect(storage.raw.size).toBe(0);
    expect(await newCache.get(cacheKey(oldNamespace, "bijoy"))).toBeUndefined();
  });

  it("prunes on a rules-hash change too, not only an engine-version change", async () => {
    const storage = fakeStorage();
    const oldNamespace = cacheNamespace({ name: "patterns", engineVersion: "1.0.0", rulesHash: "bbbb2222" });
    const oldCache = createBrowserCache<string>({ maxEntries: 10, namespace: oldNamespace, storage });
    await oldCache.set(cacheKey(oldNamespace, "bijoy"), "output from the old rule table");

    createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });
    expect(storage.raw.size).toBe(0);
  });

  it("leaves the current namespace alone", async () => {
    const storage = fakeStorage();
    const first = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });
    await first.set(cacheKey(NAMESPACE, "bijoy"), "fresh");

    const second = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });
    expect(await second.get(cacheKey(NAMESPACE, "bijoy"))).toBe("fresh");
  });
});

describe("createBrowserCache: TTL", () => {
  it("expires and removes", async () => {
    const clock = testClock();
    const storage = fakeStorage();
    const cache = createBrowserCache<string>({
      maxEntries: 10,
      namespace: NAMESPACE,
      storage,
      now: clock.now,
    });
    const key = cacheKey(NAMESPACE, "bijoy");

    await cache.set(key, "alpha", { ttlMs: 100 });
    clock.advance(99);
    expect(await cache.get(key)).toBe("alpha");
    clock.advance(1);
    expect(await cache.get(key)).toBeUndefined();
    expect(storage.raw.size).toBe(0);
  });
});

describe("createBrowserCache: eviction", () => {
  it("holds no more than maxEntries", async () => {
    const clock = testClock();
    const storage = fakeStorage();
    const cache = createBrowserCache<number>({
      maxEntries: 3,
      namespace: NAMESPACE,
      storage,
      now: clock.now,
    });
    for (let i = 0; i < 8; i++) {
      clock.advance(1); // distinct lastUsedAt, so recency is well defined
      await cache.set(cacheKey(NAMESPACE, `k${i}`), i);
    }
    expect(await cache.size()).toBe(3);
  });

  it("evicts the least recently used when full", async () => {
    const clock = testClock();
    const storage = fakeStorage();
    const cache = createBrowserCache<number>({
      maxEntries: 2,
      namespace: NAMESPACE,
      storage,
      now: clock.now,
    });
    const a = cacheKey(NAMESPACE, "a");
    const b = cacheKey(NAMESPACE, "b");
    const c = cacheKey(NAMESPACE, "c");

    await cache.set(a, 1);
    clock.advance(10);
    await cache.set(b, 2);
    clock.advance(10);
    expect(await cache.get(a)).toBe(1); // refreshes a
    clock.advance(10);
    await cache.set(c, 3);

    expect(await cache.get(b)).toBeUndefined();
    expect(await cache.get(a)).toBe(1);
    expect(await cache.get(c)).toBe(3);
  });
});

describe("createBrowserCache: degrading safely", () => {
  it("behaves as a permanent miss when storage is absent", async () => {
    const cache = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage: null });
    await expect(cache.set(cacheKey(NAMESPACE, "a"), "alpha")).resolves.toBeUndefined();
    expect(await cache.get(cacheKey(NAMESPACE, "a"))).toBeUndefined();
    expect(await cache.size()).toBe(0);
    await expect(cache.clear()).resolves.toBeUndefined();
  });

  it("does not throw when every storage operation throws", async () => {
    const storage = fakeStorage({ throwOnEverything: true });
    const cache = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });
    await expect(cache.set(cacheKey(NAMESPACE, "a"), "alpha")).resolves.toBeUndefined();
    expect(await cache.get(cacheKey(NAMESPACE, "a"))).toBeUndefined();
    expect(await cache.size()).toBe(0);
  });

  it("makes room from its own entries when the quota is hit, and never throws", async () => {
    const clock = testClock();
    // Quota of 2 items, but a ceiling of 10, so maxEntries cannot be what
    // keeps us under it — the QuotaExceededError path has to do the work.
    const storage = fakeStorage({ maxItems: 2 });
    const cache = createBrowserCache<string>({
      maxEntries: 10,
      namespace: NAMESPACE,
      storage,
      now: clock.now,
    });

    for (let i = 0; i < 5; i++) {
      clock.advance(1);
      await expect(cache.set(cacheKey(NAMESPACE, `k${i}`), `v${i}`)).resolves.toBeUndefined();
    }

    expect(storage.raw.size).toBeLessThanOrEqual(2);
    // And the most recent write survived, which is the point of evicting the
    // oldest rather than refusing the write.
    expect(await cache.get(cacheKey(NAMESPACE, "k4"))).toBe("v4");
  });

  it("never evicts keys it does not own to make room", async () => {
    const storage = fakeStorage({ maxItems: 2 });
    storage.setItem("other-app:token", "not mine");
    const cache = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });

    for (let i = 0; i < 4; i++) await cache.set(cacheKey(NAMESPACE, `k${i}`), `v${i}`);

    expect(storage.getItem("other-app:token")).toBe("not mine");
  });

  it("treats a corrupted entry as a miss and removes it", async () => {
    const storage = fakeStorage();
    const key = cacheKey(NAMESPACE, "bijoy");
    storage.setItem(key, "{ not json");
    const cache = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });

    expect(await cache.get(key)).toBeUndefined();
    expect(storage.getItem(key)).toBeNull();
  });

  it("treats an entry of the wrong shape as a miss", async () => {
    const storage = fakeStorage();
    const key = cacheKey(NAMESPACE, "bijoy");
    storage.setItem(key, JSON.stringify({ somethingElse: true }));
    const cache = createBrowserCache<string>({ maxEntries: 10, namespace: NAMESPACE, storage });

    expect(await cache.get(key)).toBeUndefined();
    expect(storage.getItem(key)).toBeNull();
  });
});
