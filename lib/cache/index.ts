/**
 * The cache layer's public surface. Import from here, not from the
 * individual modules, so the set of things a caller can reach stays small
 * and the backing of a store can change without touching call sites.
 *
 * Nothing in `features/converter/engine/**` may import this — see
 * `lib/cache/__tests__/boundary.test.ts`. `convertLegacyText` stays pure and
 * does no I/O; a cache lookup in the conversion path would make conversion
 * depend on storage that is allowed to fail.
 */
export type { CacheEntry, CacheSetOptions, CacheStore, CacheStoreOptions } from "./types";
export { createMemoryCache } from "./memoryCache";
export { createBrowserCache, type BrowserCacheOptions } from "./browserCache";
export { CACHE_KEY_PREFIX, CACHE_SCHEMA_VERSION, cacheKey, cacheNamespace, isOwnCacheKey } from "./keys";
export type { CacheNamespaceInput } from "./keys";
