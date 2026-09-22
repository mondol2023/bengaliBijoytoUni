import { describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "@/lib/cache";
import {
  KNOWN_PATTERNS_FRESH_MS,
  fetchKnownPatterns,
  knownPatternsNamespace,
  type CachedSnapshot,
} from "../knownPatternsClient";

/**
 * The wire payload, deliberately written without `resolutions` — snapshots
 * in this shape are sitting in browsers' `localStorage` today, and the
 * client has to keep accepting them.
 */
const SNAPSHOT = {
  encodingId: "bijoy",
  engineVersion: "1.0.0",
  patterns: [{ failedSequence: "Av", failureCategory: "unmapped_character", status: "open" }],
  generatedAt: "2026-09-21T00:00:00.000Z",
};

/** What that payload becomes after parsing: the missing array is defaulted. */
const PARSED = { ...SNAPSHOT, resolutions: [] };

function jsonResponse(body: unknown, etag = '"abc123"'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: etag },
  });
}

function notModified(etag = '"abc123"'): Response {
  return new Response(null, { status: 304, headers: { ETag: etag } });
}

function harness(start = 1_000) {
  let current = start;
  return {
    store: createMemoryCache<CachedSnapshot>({ maxEntries: 8, now: () => current }),
    now: () => current,
    advance: (ms: number) => void (current += ms),
  };
}

describe("fetchKnownPatterns", () => {
  it("fetches and returns a snapshot on a cold cache", async () => {
    const { store, now } = harness();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT));

    const result = await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now });

    expect(result).toStrictEqual(PARSED);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("encodingId=bijoy");
  });

  it("does not ask again while the snapshot is fresh", async () => {
    const { store, now } = harness();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT));

    await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now });
    const second = await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now });

    expect(second).toStrictEqual(PARSED);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("revalidates with If-None-Match once stale, and reuses the body on 304", async () => {
    const h = harness();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAPSHOT, '"v1"'))
      .mockResolvedValueOnce(notModified('"v1"'));

    await fetchKnownPatterns({ encodingId: "bijoy", store: h.store, fetchImpl, now: h.now });
    h.advance(KNOWN_PATTERNS_FRESH_MS + 1);
    const revalidated = await fetchKnownPatterns({
      encodingId: "bijoy",
      store: h.store,
      fetchImpl,
      now: h.now,
    });

    expect(revalidated).toStrictEqual(PARSED);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, init] = fetchImpl.mock.calls[1];
    expect((init as RequestInit).headers).toStrictEqual({ "If-None-Match": '"v1"' });
  });

  it("treats a 304 as a freshness extension, not a one-off", async () => {
    const h = harness();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAPSHOT, '"v1"'))
      .mockResolvedValueOnce(notModified('"v1"'));

    await fetchKnownPatterns({ encodingId: "bijoy", store: h.store, fetchImpl, now: h.now });
    h.advance(KNOWN_PATTERNS_FRESH_MS + 1);
    await fetchKnownPatterns({ encodingId: "bijoy", store: h.store, fetchImpl, now: h.now });
    // Still inside the renewed freshness window: no third request.
    await fetchKnownPatterns({ encodingId: "bijoy", store: h.store, fetchImpl, now: h.now });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("takes a new body when the server sends one", async () => {
    const h = harness();
    const updated = { ...SNAPSHOT, patterns: [] };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAPSHOT, '"v1"'))
      .mockResolvedValueOnce(jsonResponse(updated, '"v2"'));

    await fetchKnownPatterns({ encodingId: "bijoy", store: h.store, fetchImpl, now: h.now });
    h.advance(KNOWN_PATTERNS_FRESH_MS + 1);
    const result = await fetchKnownPatterns({
      encodingId: "bijoy",
      store: h.store,
      fetchImpl,
      now: h.now,
    });

    expect(result).toStrictEqual({ ...updated, resolutions: [] });
  });

  it("sends no validator when nothing is cached", async () => {
    const { store, now } = harness();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT));
    await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).headers).toBeUndefined();
  });
});

describe("fetchKnownPatterns: never breaks the caller", () => {
  it("returns null when the request throws and nothing is cached", async () => {
    const { store, now } = harness();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now })).toBeNull();
  });

  it("falls back to the stale copy when the request throws", async () => {
    const h = harness();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAPSHOT))
      .mockRejectedValueOnce(new Error("offline"));

    await fetchKnownPatterns({ encodingId: "bijoy", store: h.store, fetchImpl, now: h.now });
    h.advance(KNOWN_PATTERNS_FRESH_MS + 1);

    expect(
      await fetchKnownPatterns({ encodingId: "bijoy", store: h.store, fetchImpl, now: h.now }),
    ).toStrictEqual(PARSED);
  });

  it("returns null on a server error with a cold cache", async () => {
    const { store, now } = harness();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now })).toBeNull();
  });

  it("rejects a payload that does not validate rather than caching it", async () => {
    const { store, now } = harness();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ patterns: "not an array" }));

    expect(await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now })).toBeNull();
    expect(await store.size()).toBe(0);
  });

  it("survives a response that is not JSON at all", async () => {
    const { store, now } = harness();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html>a proxy error page</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now })).toBeNull();
  });
});

describe("fetchKnownPatterns: namespacing", () => {
  it("separates encodings", async () => {
    const { store, now } = harness();
    // A fresh Response per call: a `Response` body can only be read once, so
    // reusing one object would make the second call look like a parse failure.
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(SNAPSHOT));

    await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl, now });
    await fetchKnownPatterns({ encodingId: "sutonny", store, fetchImpl, now });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await store.size()).toBe(2);
  });

  it("puts a different rules hash in a different namespace", () => {
    expect(knownPatternsNamespace("aaaa1111")).not.toBe(knownPatternsNamespace("bbbb2222"));
  });

  it("re-fetches when the rules hash changes, because the key changes with it", async () => {
    const { store, now } = harness();
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(SNAPSHOT));

    await fetchKnownPatterns({ encodingId: "bijoy", rulesHash: "aaaa1111", store, fetchImpl, now });
    await fetchKnownPatterns({ encodingId: "bijoy", rulesHash: "bbbb2222", store, fetchImpl, now });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await store.size()).toBe(2);
  });
});
