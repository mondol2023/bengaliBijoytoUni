import { describe, expect, it } from "vitest";
import { CONVERSION_ENGINE_VERSION } from "@/features/converter/engine/version";
import { CACHE_KEY_PREFIX, cacheKey, cacheNamespace, isOwnCacheKey } from "../keys";

describe("cacheNamespace", () => {
  it("defaults to the engine version actually shipped", () => {
    expect(cacheNamespace({ name: "patterns" })).toContain(`:${CONVERSION_ENGINE_VERSION}:`);
  });

  it("changes when the engine version changes", () => {
    const before = cacheNamespace({ name: "patterns", engineVersion: "1.0.0", rulesHash: "aaaa1111" });
    const after = cacheNamespace({ name: "patterns", engineVersion: "1.0.1", rulesHash: "aaaa1111" });
    expect(after).not.toBe(before);
  });

  it("changes when the rules hash changes", () => {
    const before = cacheNamespace({ name: "patterns", engineVersion: "1.0.0", rulesHash: "aaaa1111" });
    const after = cacheNamespace({ name: "patterns", engineVersion: "1.0.0", rulesHash: "bbbb2222" });
    expect(after).not.toBe(before);
  });

  it("separates different value families", () => {
    expect(cacheNamespace({ name: "patterns" })).not.toBe(cacheNamespace({ name: "summary" }));
  });

  it("is stable for identical input, which is what makes a hit possible at all", () => {
    const input = { name: "patterns", engineVersion: "1.0.0", rulesHash: "aaaa1111" } as const;
    expect(cacheNamespace(input)).toBe(cacheNamespace({ ...input }));
  });
});

describe("cacheKey", () => {
  const namespace = cacheNamespace({ name: "patterns", engineVersion: "1.0.0", rulesHash: "aaaa1111" });

  it("builds a key inside its namespace", () => {
    expect(cacheKey(namespace, "bijoy")).toBe(`${namespace}:bijoy`);
  });

  it("cannot collide across different part lists", () => {
    // Without encoding, ["a:b"] and ["a", "b"] would be the same key.
    expect(cacheKey(namespace, "a:b")).not.toBe(cacheKey(namespace, "a", "b"));
  });

  it("survives a part containing a separator or a space", () => {
    const key = cacheKey(namespace, "enc:with spaces");
    expect(key.startsWith(`${namespace}:`)).toBe(true);
    expect(key.slice(namespace.length + 1)).not.toContain(" ");
  });
});

describe("isOwnCacheKey", () => {
  it("recognizes keys this codebase wrote", () => {
    expect(isOwnCacheKey(cacheKey(cacheNamespace({ name: "patterns" }), "bijoy"))).toBe(true);
  });

  it("rejects anything else on the origin", () => {
    expect(isOwnCacheKey("firebase:authUser:xyz")).toBe(false);
    expect(isOwnCacheKey("theme")).toBe(false);
    // Prefix-but-not-ours: a key that merely starts with the same letters.
    expect(isOwnCacheKey(`${CACHE_KEY_PREFIX}x:something`)).toBe(false);
  });
});
