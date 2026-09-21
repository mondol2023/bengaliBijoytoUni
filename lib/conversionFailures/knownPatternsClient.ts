/**
 * Browser-side reader for the known-patterns snapshot.
 *
 * Freshness and validity are two different questions and are answered by two
 * different mechanisms here:
 *
 *  - `freshUntil`, stored *inside* the cached value, decides whether to ask
 *    the server at all.
 *  - the stored ETag decides whether the answer needs a body.
 *
 * That is why the cache entry itself is kept far longer than it is
 * considered fresh. The naive alternative — a store TTL that drops the
 * snapshot when it goes stale — throws away the body at exactly the moment
 * the ETag becomes useful, so every revalidation would have to download the
 * whole payload again to learn that nothing had changed. A 304 is only a
 * saving if you still hold the thing it refers to.
 *
 * Every failure path returns whatever is cached, or `null`. Nothing here may
 * throw into a render, and nothing here is on the conversion path — the
 * converter produces the same output whether this resolves, fails, or is
 * never called.
 */
import { createBrowserCache, cacheKey, cacheNamespace, type CacheStore } from "@/lib/cache";
import { knownPatternsSnapshotSchema, type KnownPatternsSnapshot } from "./knownPatterns";

export interface CachedSnapshot {
  snapshot: KnownPatternsSnapshot;
  /** The server's validator for `snapshot`, replayed as `If-None-Match`. */
  etag: string | null;
  /** Epoch ms after which the snapshot should be revalidated, not discarded. */
  freshUntil: number;
}

/** Long enough to be worth caching, short enough that a new pattern shows up the same session. */
export const KNOWN_PATTERNS_FRESH_MS = 10 * 60 * 1000;

/** How long a stale-but-revalidatable entry is kept. Six times the freshness window. */
export const KNOWN_PATTERNS_RETAIN_MS = KNOWN_PATTERNS_FRESH_MS * 6;

const MAX_CACHED_ENCODINGS = 8;

export interface FetchKnownPatternsOptions {
  encodingId: string;
  /** Part of the cache namespace, so a rule-table change cannot serve a stale snapshot. */
  rulesHash?: string | null;
  limit?: number;
  /** Injectable for tests; defaults to the cache backed by `localStorage`. */
  store?: CacheStore<CachedSnapshot>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
  signal?: AbortSignal;
}

export function knownPatternsNamespace(rulesHash: string | null = null): string {
  return cacheNamespace({ name: "known-patterns", rulesHash });
}

function defaultStore(rulesHash: string | null): CacheStore<CachedSnapshot> {
  return createBrowserCache<CachedSnapshot>({
    maxEntries: MAX_CACHED_ENCODINGS,
    namespace: knownPatternsNamespace(rulesHash),
    defaultTtlMs: KNOWN_PATTERNS_RETAIN_MS,
  });
}

function originOf(): string {
  return typeof globalThis.location === "undefined" ? "http://localhost" : globalThis.location.origin;
}

/**
 * The cached snapshot when it is fresh; otherwise a conditional request,
 * falling back to the stale copy on anything that goes wrong. `null` only
 * when there is nothing cached and nothing valid came back.
 */
export async function fetchKnownPatterns(
  options: FetchKnownPatternsOptions,
): Promise<KnownPatternsSnapshot | null> {
  const { encodingId, rulesHash = null, limit, signal, now = Date.now } = options;
  const store = options.store ?? defaultStore(rulesHash);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const key = cacheKey(knownPatternsNamespace(rulesHash), encodingId, String(limit ?? "default"));

  const cached = await store.get(key);
  if (cached !== undefined && now() < cached.freshUntil) return cached.snapshot;

  const url = new URL("/api/conversion-failures/known", originOf());
  url.searchParams.set("encodingId", encodingId);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      signal,
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
  } catch {
    return cached?.snapshot ?? null;
  }

  if (response.status === 304 && cached !== undefined) {
    await store.set(key, { ...cached, freshUntil: now() + KNOWN_PATTERNS_FRESH_MS });
    return cached.snapshot;
  }

  if (!response.ok) return cached?.snapshot ?? null;

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return cached?.snapshot ?? null;
  }

  const parsed = knownPatternsSnapshotSchema.safeParse(json);
  if (!parsed.success) {
    // A payload we cannot validate is not better than the one we already
    // have; it is worse, because we do not know what it is.
    return cached?.snapshot ?? null;
  }

  await store.set(key, {
    snapshot: parsed.data,
    etag: response.headers.get("etag"),
    freshUntil: now() + KNOWN_PATTERNS_FRESH_MS,
  });
  return parsed.data;
}
