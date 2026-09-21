import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../memoryCache";

/** Advances explicitly, so TTL tests are deterministic without touching global timers. */
function testClock(start = 1_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createMemoryCache: basics", () => {
  it("returns what was stored, and undefined for a key never stored", async () => {
    const cache = createMemoryCache<string>({ maxEntries: 10 });
    await cache.set("a", "alpha");
    expect(await cache.get("a")).toBe("alpha");
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("overwrites rather than duplicating", async () => {
    const cache = createMemoryCache<string>({ maxEntries: 10 });
    await cache.set("a", "first");
    await cache.set("a", "second");
    expect(await cache.get("a")).toBe("second");
    expect(await cache.size()).toBe(1);
  });

  it("deletes and clears", async () => {
    const cache = createMemoryCache<string>({ maxEntries: 10 });
    await cache.set("a", "alpha");
    await cache.set("b", "beta");
    await cache.delete("a");
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.size()).toBe(1);
    await cache.clear();
    expect(await cache.size()).toBe(0);
    expect(await cache.get("b")).toBeUndefined();
  });

  it("refuses a ceiling that would silently disable it", () => {
    expect(() => createMemoryCache<string>({ maxEntries: 0 })).toThrow(/positive integer/);
    expect(() => createMemoryCache<string>({ maxEntries: -1 })).toThrow(/positive integer/);
    expect(() => createMemoryCache<string>({ maxEntries: 1.5 })).toThrow(/positive integer/);
  });
});

describe("createMemoryCache: LRU eviction", () => {
  it("never exceeds maxEntries", async () => {
    const cache = createMemoryCache<number>({ maxEntries: 3 });
    for (let i = 0; i < 10; i++) await cache.set(`k${i}`, i);
    expect(await cache.size()).toBe(3);
  });

  it("evicts the least recently *used*, not the least recently written", async () => {
    const cache = createMemoryCache<number>({ maxEntries: 3 });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);

    // Touching "a" must save it from the eviction that "d" triggers.
    expect(await cache.get("a")).toBe(1);
    await cache.set("d", 4);

    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe(1);
    expect(await cache.get("c")).toBe(3);
    expect(await cache.get("d")).toBe(4);
  });

  it("treats an overwrite as a use", async () => {
    const cache = createMemoryCache<number>({ maxEntries: 2 });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("a", 11);
    await cache.set("c", 3);
    // "b" is now the oldest use, so it goes; "a" was refreshed by the rewrite.
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe(11);
  });
});

describe("createMemoryCache: TTL", () => {
  it("expires an entry once its TTL has elapsed", async () => {
    const clock = testClock();
    const cache = createMemoryCache<string>({ maxEntries: 10, now: clock.now });
    await cache.set("a", "alpha", { ttlMs: 100 });

    clock.advance(99);
    expect(await cache.get("a")).toBe("alpha");

    clock.advance(1); // exactly at expiry
    expect(await cache.get("a")).toBeUndefined();
  });

  it("applies defaultTtlMs when set passes none, and lets a call override it", async () => {
    const clock = testClock();
    const cache = createMemoryCache<string>({ maxEntries: 10, defaultTtlMs: 50, now: clock.now });
    await cache.set("short", "s");
    await cache.set("long", "l", { ttlMs: 500 });
    await cache.set("forever", "f", { ttlMs: null });

    clock.advance(100);
    expect(await cache.get("short")).toBeUndefined();
    expect(await cache.get("long")).toBe("l");
    expect(await cache.get("forever")).toBe("f");
  });

  it("does not count expired entries in size", async () => {
    const clock = testClock();
    const cache = createMemoryCache<string>({ maxEntries: 10, now: clock.now });
    await cache.set("a", "alpha", { ttlMs: 10 });
    await cache.set("b", "beta", { ttlMs: 1_000 });
    clock.advance(20);
    expect(await cache.size()).toBe(1);
  });

  it("drops an expired entry rather than keeping it alive on read", async () => {
    const clock = testClock();
    const cache = createMemoryCache<string>({ maxEntries: 10, now: clock.now });
    await cache.set("a", "alpha", { ttlMs: 10 });
    clock.advance(20);
    expect(await cache.get("a")).toBeUndefined();
    // A second read must not resurrect it, and the entry must be gone, not
    // merely hidden — otherwise expired entries accumulate against maxEntries.
    expect(await cache.size()).toBe(0);
  });
});
