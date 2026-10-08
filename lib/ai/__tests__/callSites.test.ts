/**
 * Guard B: the reachability inventory for `lib/ai/*`.
 *
 * `security.test.ts` already proves a provider module throws if it is ever
 * evaluated in a browser, and that no client-reachable file names an API key.
 * This file answers the different question the reviewer actually asked: *from
 * where, exactly, can a provider be reached at all* — and, in the other
 * direction, that the deterministic conversion path cannot reach `lib/ai`
 * from anywhere.
 *
 * Two deliberate differences from `security.test.ts`:
 *
 *  - It does not skip `app/api/**`. That file excludes any path containing
 *    `/api/`, on the reasoning that server-only route handlers are allowed to
 *    reach the registry. True for the registry, but it also means the
 *    conversion *endpoints* were never checked, and those are exactly the
 *    ones that must stay AI-free.
 *  - The expected call sites are asserted as an exact set, not as an absence.
 *    A prose list of call sites is stale the moment someone adds one; a set
 *    equality fails on the commit that adds it and names the new file.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_RESOLUTION_ENABLED_ENV } from "../enabled";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** Every shipped source file under `dir`; excludes tests, which may name anything. */
function listShippedSources(dir: string): string[] {
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
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__") continue;
      files.push(...listShippedSources(full));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

/** Repo-relative, forward-slashed, so expectations read the same on Windows and CI. */
function repoRelative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

const ALL_SHIPPED_SOURCES = ["app", "components", "features", "hooks", "lib"].flatMap((dir) =>
  listShippedSources(path.join(REPO_ROOT, dir)),
);

/** Strips comments first: a module that *explains* the boundary is not a caller of it. */
function withoutComments(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function importersMatching(pattern: RegExp): string[] {
  return ALL_SHIPPED_SOURCES.filter((file) => pattern.test(withoutComments(file)))
    .map(repoRelative)
    .sort();
}

describe("the scan sees the tree it claims to", () => {
  it("collected a meaningful number of shipped sources", () => {
    expect(ALL_SHIPPED_SOURCES.length).toBeGreaterThan(50);
  });

  it("collected the known endpoints of the chain it is about to assert", () => {
    const relative = ALL_SHIPPED_SOURCES.map(repoRelative);
    expect(relative).toContain("lib/ai/registry.ts");
    expect(relative).toContain("lib/ai/providers/gemini.ts");
    expect(relative).toContain("app/api/admin/conversion-failures/[patternId]/resolve/route.ts");
  });
});

// ---------------------------------------------------------------------------
// The inventory: every call site that can reach lib/ai/providers/*
// ---------------------------------------------------------------------------

/**
 * The whole reachable chain, in one place:
 *
 *   app/api/admin/conversion-failures/[patternId]/resolve/route.ts  (admin-gated HTTP entry)
 *     -> lib/ai/resolveConversionFailure.ts                         (the only service caller)
 *       -> lib/ai/registry.ts                                       (the only provider importer; flag enforced here)
 *         -> lib/ai/providers/{gemini,openai}.ts                    (the only modules holding a key)
 *
 * and a second chain, for whole-document transcription (its own switch,
 * `AI_TRANSCRIPTION_ENABLED`, enforced in the same registry):
 *
 *   app/api/ai/transcribe/route.ts      (public HTTP entry, rate-limited; outside app/api/documents)
 *     -> lib/ai/transcribeDocument.ts   (the only transcription service)
 *       -> lib/ai/registry.ts           (getTranscriptionProvider; flag enforced here)
 *
 * and a third, for reading cropped OCR images (its own per-provider switches,
 * `OCR_<ID>_ENABLED`, enforced in the same registry):
 *
 *   app/api/ocr/improve/route.ts        (signed-in HTTP entry, rate-limited; outside app/api/documents)
 *     -> lib/ai/ocrImages.ts            (the only OCR service)
 *       -> lib/ai/registry.ts           (getOcrProviders; switches enforced here)
 *
 * Each `it` below pins one link. Adding a second admin route, or importing a
 * provider from somewhere new, fails the matching case by name.
 */
describe("Guard B: only one chain reaches a provider", () => {
  it("has exactly one module importing lib/ai/providers/*", () => {
    const pattern = /from\s+["'](?:@\/lib\/ai\/providers|\.{1,2}\/providers)\//;
    expect(importersMatching(pattern)).toStrictEqual(["lib/ai/registry.ts"]);
  });

  it("has exactly the three service modules importing the registry", () => {
    const pattern = /from\s+["'](?:@\/lib\/ai\/registry|\.{1,2}\/registry)["']/;
    expect(importersMatching(pattern)).toStrictEqual([
      "lib/ai/ocrImages.ts",
      "lib/ai/resolveConversionFailure.ts",
      "lib/ai/transcribeDocument.ts",
    ]);
  });

  it("has exactly one route importing the OCR service, outside the conversion path", () => {
    const pattern = /from\s+["'](?:@\/lib\/ai\/ocrImages|\.{1,2}\/ocrImages)["']/;
    expect(importersMatching(pattern)).toStrictEqual(["app/api/ocr/improve/route.ts"]);
  });

  it("has exactly one route importing the transcription service, outside the conversion path", () => {
    const pattern = /from\s+["'](?:@\/lib\/ai\/transcribeDocument|\.{1,2}\/transcribeDocument)["']/;
    expect(importersMatching(pattern)).toStrictEqual(["app/api/ai/transcribe/route.ts"]);
  });

  it("has exactly one route importing the resolution service", () => {
    const pattern = /from\s+["'](?:@\/lib\/ai\/resolveConversionFailure|\.{1,2}\/resolveConversionFailure)["']/;
    expect(importersMatching(pattern)).toStrictEqual([
      "app/api/admin/conversion-failures/[patternId]/resolve/route.ts",
    ]);
  });

  it("gates that one route behind requireAdminUser", () => {
    const route = readFileSync(
      path.join(REPO_ROOT, "app/api/admin/conversion-failures/[patternId]/resolve/route.ts"),
      "utf8",
    );
    expect(route).toContain("requireAdminUser");
  });
});

// ---------------------------------------------------------------------------
// The other direction: the conversion path can never reach lib/ai
// ---------------------------------------------------------------------------

/**
 * Everything a character travels through on its way from legacy bytes to
 * Unicode, including the API endpoints — not just `features/converter/engine`,
 * which is all `security.test.ts` covered.
 */
const CONVERSION_PATH_ROOTS = [
  "features/converter",
  // Named individually as well as covered by the directory above. The
  // directory catches an import added inside them; naming the paths catches
  // the other move -- one of them relocating out from under the scan, which
  // a directory root cannot notice.
  "features/converter/runConversion.ts",
  "features/converter/resolutionSource.ts",
  "features/documents",
  "lib/conversionFailures",
  "hooks/useConversion.ts",
  "hooks/useDocumentConversion.ts",
  "hooks/useConversionFailureReporter.ts",
  "app/api/conversions",
  "app/api/conversion-failures",
  "app/api/documents",
];

describe("Guard B: the conversion path never imports lib/ai", () => {
  it("resolves every declared conversion-path root", () => {
    for (const root of CONVERSION_PATH_ROOTS) {
      expect(() => statSync(path.join(REPO_ROOT, root)), `${root} does not exist`).not.toThrow();
    }
  });

  // De-duplicated: a file named individually above is also reached through
  // its directory, and an offender should be reported once.
  const conversionPathFiles = [...new Set(CONVERSION_PATH_ROOTS.flatMap((root) => {
    const full = path.join(REPO_ROOT, root);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      return [];
    }
    return isDirectory ? listShippedSources(full) : [full];
  }))];

  it("has conversion-path files to check", () => {
    expect(conversionPathFiles.length).toBeGreaterThan(10);
  });

  it("includes the fallback entry point by name", () => {
    const scanned = conversionPathFiles.map(repoRelative);
    expect(scanned).toContain("features/converter/runConversion.ts");
    expect(scanned).toContain("features/converter/resolutionSource.ts");
  });

  it("finds no import of lib/ai from any of them", () => {
    const offenders: string[] = [];
    for (const file of conversionPathFiles) {
      const contents = withoutComments(file);
      if (/from\s+["'][^"']*lib\/ai/.test(contents)) offenders.push(repoRelative(file));
      // A dynamic import is reachability too, and matches none of the patterns above.
      if (/import\(\s*["'][^"']*lib\/ai/.test(contents)) offenders.push(`${repoRelative(file)} (dynamic)`);
    }
    expect(offenders, "conversion must stay deterministic and free of any AI dependency").toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The OCR feature is client code: it reaches AI only over HTTP
// ---------------------------------------------------------------------------

/**
 * `features/ocr`, the `/ocr` components and its hook run in the browser. They
 * may call `/api/ocr/improve`, but must never import anything under `lib/ai`
 * (it holds provider keys and `assertServerOnly` would throw there anyway).
 * Roots the browser UI adds later (`components/ocr`, `hooks/useOcrJob.ts`) are
 * scanned as soon as they exist; `features/ocr` must exist now.
 */
describe("Guard B: the OCR feature never imports lib/ai", () => {
  const roots = ["features/ocr", "components/ocr", "hooks/useOcrJob.ts"];

  it("scans features/ocr, which must exist", () => {
    expect(() => statSync(path.join(REPO_ROOT, "features/ocr"))).not.toThrow();
  });

  it("finds no import of lib/ai from any of them", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      const full = path.join(REPO_ROOT, root);
      let files: string[];
      try {
        files = statSync(full).isDirectory() ? listShippedSources(full) : [full];
      } catch {
        continue;
      }
      for (const file of files) {
        const contents = withoutComments(file);
        if (/(?:from|import)\s+["'][^"']*lib\/ai/.test(contents)) offenders.push(repoRelative(file));
        if (/import\(\s*["'][^"']*lib\/ai/.test(contents)) offenders.push(`${repoRelative(file)} (dynamic)`);
      }
    }
    expect(offenders, "the OCR UI must reach AI only through its API route").toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The flag, end to end against a mocked provider
// ---------------------------------------------------------------------------

/**
 * `registry.test.ts` proves the lookup refuses. This proves the thing that
 * actually costs money: with the flag off, no HTTP request leaves the
 * process. `fetch` is mocked rather than a provider module, so an adapter
 * that someday bypasses the registry would still be caught here.
 */
describe("Guard B: the flag stops the outbound call, not just the lookup", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("issues no fetch when the flag is off, even with both API keys present", async () => {
    vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, undefined);
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-a-real-credential");
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-credential");

    const fetchMock = vi.fn().mockRejectedValue(new Error("no outbound call may happen with the flag off"));
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.resetModules();
    const { getResolutionProvider } = await import("../registry");
    const result = getResolutionProvider("gemini");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reaches the mocked provider once the flag is on, proving the case above is not vacuous", async () => {
    vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, "true");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-a-real-credential");

    const providerJson = JSON.stringify({
      candidateConversion: "আ",
      alternatives: [],
      confidence: "high",
      isCertain: true,
      explanation: "ok",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => providerJson,
      json: async () => ({ candidates: [{ content: { parts: [{ text: providerJson }] } }] }),
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.resetModules();
    const { getResolutionProvider } = await import("../registry");
    const lookup = getResolutionProvider("gemini");
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;

    await lookup.value.resolve({
      failurePatternId: "pattern-1",
      encodingId: "bijoy",
      failedSequence: "Av",
      codePoints: [65, 118],
      contextBefore: "",
      contextAfter: "",
      fullText: "",
      position: 0,
      currentEngineOutput: "",
      failureCategory: "unmapped_character",
      engineVersion: "engine-1.2.3",
      rulesHash: "rules-abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
