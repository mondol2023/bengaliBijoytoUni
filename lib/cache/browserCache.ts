/**
 * `localStorage`-backed cache, so a value survives a reload.
 *
 * ## Why `localStorage` rather than IndexedDB
 *
 * The only thing this caches is the top-N known-patterns snapshot: a few
 * kilobytes of short failed sequences, categories and statuses. IndexedDB is
 * the right answer for megabytes, blobs, or structured queries, and buys none
 * of that here at the cost of an async open/upgrade/transaction dance that
 * has its own failure modes to get wrong. `CacheStore` is already async, so
 * swapping the backing later changes this file and nothing else — the
 * decision is reversible, which is why it is safe to take the simple one now.
 *
 * ## Everything here can fail, and none of it may throw
 *
 * `localStorage` throws on access in a browser with site data blocked, throws
 * `QuotaExceededError` on write when full, and is simply absent during SSR
 * and in the Node test environment. Every operation is wrapped, and a failure
 * is a miss rather than an error: a cache that can break the page it is
 * meant to speed up is worse than no cache.
 */
import { CACHE_KEY_PREFIX, isOwnCacheKey } from "./keys";
import type { CacheSetOptions, CacheStore, CacheStoreOptions } from "./types";

interface StoredEntry<T> {
  value: T;
  expiresAt: number | null;
  /** Approximates recency for eviction; `localStorage` has no access order of its own. */
  lastUsedAt: number;
}

export interface BrowserCacheOptions extends CacheStoreOptions {
  /**
   * Keys outside this namespace but inside `CACHE_KEY_PREFIX` are pruned when
   * the store is created. This is how an engine-version bump reclaims the
   * space its superseded entries occupy, instead of leaving them to sit until
   * they push the origin over quota.
   */
  namespace: string;
  /** Injectable for tests; defaults to the real `localStorage` when one exists. */
  storage?: Storage | null;
}

function defaultStorage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    // Touching it is not enough — a blocked-site-data browser throws on use,
    // not on property access. A probe write is the only honest test.
    const probe = `${CACHE_KEY_PREFIX}:probe`;
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createBrowserCache<T>(options: BrowserCacheOptions): CacheStore<T> {
  const { maxEntries, defaultTtlMs = null, now = Date.now, namespace } = options;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;

  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`createBrowserCache: maxEntries must be a positive integer, received ${maxEntries}`);
  }

  /** Every key this store owns, in an unspecified order. */
  function ownKeys(): string[] {
    if (storage === null) return [];
    const keys: string[] = [];
    try {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key !== null && isOwnCacheKey(key)) keys.push(key);
      }
    } catch {
      return [];
    }
    return keys;
  }

  function read(key: string): StoredEntry<T> | undefined {
    if (storage === null) return undefined;
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return undefined;
    }
    if (raw === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("value" in parsed) ||
        !("expiresAt" in parsed) ||
        !("lastUsedAt" in parsed)
      ) {
        // Written by an older shape, or corrupted. Drop it rather than
        // hand a caller something that does not match its type.
        remove(key);
        return undefined;
      }
      return parsed as StoredEntry<T>;
    } catch {
      remove(key);
      return undefined;
    }
  }

  function remove(key: string): void {
    if (storage === null) return;
    try {
      storage.removeItem(key);
    } catch {
      // Nothing useful to do; a stale entry is harmless next to a thrown error.
    }
  }

  /** Drops the least recently used own entries until `count` have gone. */
  function evictLeastRecentlyUsed(count: number): void {
    const scored = ownKeys()
      .map((key) => ({ key, lastUsedAt: read(key)?.lastUsedAt ?? 0 }))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const { key } of scored.slice(0, count)) remove(key);
  }

  function write(key: string, entry: StoredEntry<T>): void {
    if (storage === null) return;
    const payload = JSON.stringify(entry);
    try {
      storage.setItem(key, payload);
      return;
    } catch {
      // Almost certainly quota. Make room from our own entries only — other
      // code on this origin owns its keys, and a cache is not entitled to
      // evict data it did not write.
      evictLeastRecentlyUsed(Math.max(1, Math.ceil(ownKeys().length / 2)));
    }
    try {
      storage.setItem(key, payload);
    } catch {
      // Still no room, or writes are refused outright. Give up quietly: the
      // caller gets a miss next time and fetches, which is correct.
    }
  }

  // Prune superseded namespaces once, at construction. Entries from a
  // previous engine version can never be read again, so the only thing they
  // can still do is occupy quota.
  for (const key of ownKeys()) {
    if (!key.startsWith(`${namespace}:`)) remove(key);
  }

  return {
    async get(key) {
      const entry = read(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt !== null && entry.expiresAt <= now()) {
        remove(key);
        return undefined;
      }
      write(key, { ...entry, lastUsedAt: now() });
      return entry.value;
    },

    async set(key, value, setOptions: CacheSetOptions = {}) {
      const ttlMs = setOptions.ttlMs === undefined ? defaultTtlMs : setOptions.ttlMs;
      const overBy = ownKeys().filter((existing) => existing !== key).length + 1 - maxEntries;
      if (overBy > 0) evictLeastRecentlyUsed(overBy);
      write(key, {
        value,
        expiresAt: ttlMs === null ? null : now() + ttlMs,
        lastUsedAt: now(),
      });
    },

    async delete(key) {
      remove(key);
    },

    async clear() {
      for (const key of ownKeys()) remove(key);
    },

    async size() {
      let live = 0;
      for (const key of ownKeys()) {
        const entry = read(key);
        if (entry !== undefined && (entry.expiresAt === null || entry.expiresAt > now())) live++;
      }
      return live;
    },
  };
}
