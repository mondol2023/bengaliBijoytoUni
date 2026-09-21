/**
 * Cache key construction.
 *
 * Every key carries the engine version and the rules hash that produced the
 * cached value. That is the whole invalidation strategy: there is no
 * "flush the cache" step to remember on the commit that changes a mapping
 * table, because a changed table changes `computeRulesHash`, which changes
 * the namespace, which means the old entries are simply never looked up
 * again. A cache you must remember to invalidate is a cache that will
 * eventually serve output from an engine that no longer exists — and in this
 * codebase that means showing a user Bengali text the current engine would
 * not produce.
 *
 * The keys are also prefixed, because `localStorage` is a single flat
 * namespace shared with anything else the origin stores. The prefix is what
 * lets a store clear only its own entries, and lets the browser store prune
 * entries from superseded engine versions without touching unrelated keys.
 */
import { CONVERSION_ENGINE_VERSION } from "@/features/converter/engine/version";

/**
 * Bumped by hand when the *shape* of a cached value changes in a way the
 * engine version would not capture — a new field in the snapshot payload,
 * say. Separate from `CONVERSION_ENGINE_VERSION` because the two change for
 * unrelated reasons.
 */
export const CACHE_SCHEMA_VERSION = "1";

/** Shared by every key this codebase writes, so a store can find its own. */
export const CACHE_KEY_PREFIX = `c2u:${CACHE_SCHEMA_VERSION}`;

export interface CacheNamespaceInput {
  /** What is cached, e.g. `patterns`. Not a key — a family of keys. */
  name: string;
  /** Defaults to the current engine version; injectable so tests can prove invalidation. */
  engineVersion?: string;
  /**
   * The encoding's rule fingerprint, when the cached value depends on the
   * rules. `null` for values that do not (a cross-encoding listing, say).
   */
  rulesHash?: string | null;
}

/**
 * `c2u:<schema>:<name>:<engineVersion>:<rulesHash>` — the stable part of a
 * key. Two callers with the same namespace share entries; any difference in
 * engine version or rules hash puts them in disjoint spaces.
 */
export function cacheNamespace({
  name,
  engineVersion = CONVERSION_ENGINE_VERSION,
  rulesHash = null,
}: CacheNamespaceInput): string {
  return `${CACHE_KEY_PREFIX}:${name}:${engineVersion}:${rulesHash ?? "norules"}`;
}

/**
 * A full key. Parts are joined with a separator that cannot appear in an
 * encoding id or a status, and each part is encoded, so two different part
 * lists can never collide into the same key.
 */
export function cacheKey(namespace: string, ...parts: string[]): string {
  return [namespace, ...parts.map((part) => encodeURIComponent(part))].join(":");
}

/** True for a key this codebase owns — used to prune without touching other origin data. */
export function isOwnCacheKey(key: string): boolean {
  return key.startsWith(`${CACHE_KEY_PREFIX}:`);
}
