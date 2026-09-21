/**
 * In-memory LRU with per-entry TTL.
 *
 * Recency comes from `Map` iteration order rather than a separate list: a
 * `Map` iterates in insertion order, so deleting and re-inserting a key on
 * read moves it to the back, and the first key the iterator yields is the
 * least recently used. That is the whole eviction policy, with no second
 * data structure to keep in sync with the first — the usual source of LRU
 * bugs.
 *
 * On the server this is per-instance and best-effort: several instances each
 * hold their own map, and every map dies on a cold start. Nothing may depend
 * on a hit.
 */
import type { CacheSetOptions, CacheStore, CacheStoreOptions, CacheEntry } from "./types";

export function createMemoryCache<T>(options: CacheStoreOptions): CacheStore<T> {
  const { maxEntries, defaultTtlMs = null, now = Date.now } = options;

  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    // A zero or negative ceiling would make every `set` a no-op, which looks
    // exactly like a working cache that never hits — the kind of thing that
    // gets diagnosed as a performance problem weeks later.
    throw new Error(`createMemoryCache: maxEntries must be a positive integer, received ${maxEntries}`);
  }

  const entries = new Map<string, CacheEntry<T>>();

  function isExpired(entry: CacheEntry<T>): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= now();
  }

  function evictIfNeeded(): void {
    while (entries.size > maxEntries) {
      // `Map` keys iterate oldest-first; the first is the LRU entry.
      const oldest = entries.keys().next();
      if (oldest.done) return;
      entries.delete(oldest.value);
    }
  }

  return {
    async get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (isExpired(entry)) {
        entries.delete(key);
        return undefined;
      }
      // Re-insert to mark as most recently used.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },

    async set(key, value, setOptions: CacheSetOptions = {}) {
      const ttlMs = setOptions.ttlMs === undefined ? defaultTtlMs : setOptions.ttlMs;
      // Delete first so an overwrite counts as a fresh use rather than
      // keeping the key at its old position in the eviction order.
      entries.delete(key);
      entries.set(key, { value, expiresAt: ttlMs === null ? null : now() + ttlMs });
      evictIfNeeded();
    },

    async delete(key) {
      entries.delete(key);
    },

    async clear() {
      entries.clear();
    },

    async size() {
      // Expired-but-not-yet-evicted entries are not held against the count;
      // reporting them would make the instrumentation in item 5 overstate
      // what the cache is actually holding.
      let live = 0;
      for (const entry of entries.values()) if (!isExpired(entry)) live++;
      return live;
    },
  };
}
