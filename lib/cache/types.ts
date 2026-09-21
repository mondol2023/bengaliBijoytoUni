/**
 * One cache interface, two backings: an in-memory LRU (server instance, or a
 * browser tab's lifetime) and `localStorage` (survives a reload).
 *
 * Every method is async even though the in-memory store answers instantly.
 * That is not future-proofing for its own sake: a persistent browser store is
 * asynchronous — IndexedDB certainly, and `localStorage` only looks
 * synchronous because it blocks the main thread. A synchronous interface
 * would have been the one design that cannot accommodate both, and callers
 * would have had to know which store they were holding, which defeats the
 * point of the interface.
 *
 * ## What a cache here is allowed to be wrong about
 *
 * Nothing in this codebase may depend on a cache hit for correctness. A store
 * may return `undefined` at any time for any reason — evicted, expired,
 * storage disabled, quota exceeded, a different server instance, a private
 * window. Every caller must produce the same answer with an empty cache as
 * with a full one, only slower. The server-side in-memory store is explicitly
 * best-effort per instance: on a serverless host there may be many instances,
 * each with its own map, and all of them vanish on a cold start.
 *
 * ## What a cache here must never hold
 *
 * User document text. Not a full document, not a paragraph, not a sentence.
 * The only conversion-derived data that belongs in a cache is what the
 * failure-reporting privacy bound already permits to leave the browser: a
 * short failed sequence, a category, a status, a count.
 * `lib/cache/__tests__/privacy.test.ts` asserts this against the actual
 * snapshot payload rather than trusting the convention.
 */

/** A value plus the moment it stops being valid. `null` means no expiry. */
export interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

export interface CacheSetOptions {
  /**
   * Overrides the store's `defaultTtlMs` for this entry. `null` stores it
   * with no expiry; omitted uses the store default.
   */
  ttlMs?: number | null;
}

export interface CacheStore<T> {
  /** The value, or `undefined` for a miss, an expired entry, or an unavailable store. */
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /** Drops everything this store owns. Never touches keys outside its namespace. */
  clear(): Promise<void>;
  /**
   * Entries currently held, for tests and for the instrumentation in item 5.
   * Cheap to compute; not a correctness signal.
   */
  size(): Promise<number>;
}

export interface CacheStoreOptions {
  /**
   * Hard ceiling. Reaching it evicts the least recently used entry, so a
   * cache cannot grow into a memory leak on a long-lived server instance.
   */
  maxEntries: number;
  /** Applied to `set` calls that pass no `ttlMs`. `null` means entries do not expire. */
  defaultTtlMs?: number | null;
  /**
   * Injectable clock. Tests advance it directly rather than installing fake
   * timers, which keeps TTL tests deterministic without touching global state
   * that other tests in the same worker can observe.
   */
  now?: () => number;
}
