/**
 * Nothing cached anywhere in this codebase may hold user document text.
 *
 * The cache is a tempting place for it — a converted document is expensive
 * to recompute and obviously cacheable — and `localStorage` is the one store
 * here that outlives the tab, is readable by any script on the origin, and
 * is not covered by the privacy bound that governs what leaves the browser.
 * So this is asserted three ways: the payload's shape, the validator's
 * behavior on a server that sends more than it should, and a source scan for
 * the field names that would carry document text.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "../memoryCache";
import { knownPatternsSnapshotSchema } from "@/lib/conversionFailures/knownPatterns";
import {
  fetchKnownPatterns,
  type CachedSnapshot,
} from "@/lib/conversionFailures/knownPatternsClient";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const DOCUMENT_TEXT = "the user's entire pasted document, which must never be cached";

describe("the cached snapshot carries no document text", () => {
  it("drops fields the server should not have sent, because the schema strips them", () => {
    const parsed = knownPatternsSnapshotSchema.parse({
      encodingId: "bijoy",
      engineVersion: "1.0.0",
      generatedAt: "2026-09-21T00:00:00.000Z",
      patterns: [
        {
          failedSequence: "Av",
          failureCategory: "unmapped_character",
          status: "open",
          fullText: DOCUMENT_TEXT,
          engineOutput: DOCUMENT_TEXT,
        },
      ],
      fullText: DOCUMENT_TEXT,
    });

    expect(JSON.stringify(parsed)).not.toContain("entire pasted document");
    expect(Object.keys(parsed.patterns[0]).sort()).toStrictEqual([
      "failedSequence",
      "failureCategory",
      "status",
    ]);
  });

  it("stores only the validated snapshot, even when the response carried more", async () => {
    const store = createMemoryCache<CachedSnapshot>({ maxEntries: 4 });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          encodingId: "bijoy",
          engineVersion: "1.0.0",
          generatedAt: "2026-09-21T00:00:00.000Z",
          patterns: [
            {
              failedSequence: "Av",
              failureCategory: "unmapped_character",
              status: "open",
              contextBefore: DOCUMENT_TEXT,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json", ETag: '"v1"' } },
      ),
    );

    await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl });

    // Read back everything the store now holds, exactly as it holds it.
    const cached = await store.get(
      (await import("@/lib/cache")).cacheKey(
        (await import("@/lib/conversionFailures/knownPatternsClient")).knownPatternsNamespace(null),
        "bijoy",
        "default",
      ),
    );
    expect(cached).toBeDefined();
    expect(JSON.stringify(cached)).not.toContain("entire pasted document");
  });

  it("holds nothing at all when the payload does not validate", async () => {
    const store = createMemoryCache<CachedSnapshot>({ maxEntries: 4 });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ patterns: DOCUMENT_TEXT }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await fetchKnownPatterns({ encodingId: "bijoy", store, fetchImpl });
    expect(await store.size()).toBe(0);
  });
});

/**
 * The names a document's text travels under in this codebase. A cache module
 * mentioning one of them is either caching it or about to.
 */
const DOCUMENT_TEXT_FIELDS = ["sourceText", "unicodeText", "fullText", "engineOutput"];

function sourcesIn(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...sourcesIn(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function withoutComments(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("no cache module names a document-text field", () => {
  const cacheSources = sourcesIn(path.join(REPO_ROOT, "lib", "cache"));

  it("found the cache modules it is about to scan", () => {
    expect(cacheSources.length).toBeGreaterThanOrEqual(4);
  });

  it("finds no document-text field in lib/cache", () => {
    const offenders: string[] = [];
    for (const file of cacheSources) {
      const contents = withoutComments(file);
      for (const field of DOCUMENT_TEXT_FIELDS) {
        if (contents.includes(field)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} mentions ${field}`);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it("finds none in the one module that puts things in the browser cache either", () => {
    const client = withoutComments(
      path.join(REPO_ROOT, "lib", "conversionFailures", "knownPatternsClient.ts"),
    );
    for (const field of DOCUMENT_TEXT_FIELDS) {
      expect(client, `knownPatternsClient must not touch ${field}`).not.toContain(field);
    }
  });
});
