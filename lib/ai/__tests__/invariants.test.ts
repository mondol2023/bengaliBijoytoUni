/**
 * Enforces `docs/conversion-failure-pipeline.md` §10 ("What this system
 * deliberately does NOT do") as executable invariants rather than prose.
 *
 * Companion to `security.test.ts`, which does the same job for §8. The
 * per-module unit tests prove each piece behaves correctly today; these prove
 * the three system-wide guarantees still hold after any of those pieces
 * changes — including pieces that don't exist yet (the §9 admin UI).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: vi.fn() }));

vi.mock("@/lib/firebase/conversionFailures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/firebase/conversionFailures")>();
  return { ...actual, getFailurePatternById: vi.fn() };
});

import { getAdminDb } from "@/lib/firebase/admin";
import { getFailurePatternById, type WithId } from "@/lib/firebase/conversionFailures";
import {
  aiResolutionSchema,
  type AiResolution,
  type ConversionFailure,
  type FailurePattern,
} from "@/lib/firebase/schemas";
import { reviewConversionResolution } from "../reviewConversionResolution";
import type { ConversionResolutionRequest, ResolutionOptions } from "../types";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** Non-test sources only — a test file may legitimately read `fs` or name a collection these invariants forbid in shipped code. */
function listShippedSources(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__") continue;
      files.push(...listShippedSources(fullPath));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const AI_LIB_DIR = path.join(REPO_ROOT, "lib", "ai");
const ADMIN_ROUTE_DIR = path.join(REPO_ROOT, "app", "api", "admin", "conversion-failures");
const ENCODINGS_DIR = path.join(REPO_ROOT, "features", "converter", "encodings");

// ---------------------------------------------------------------------------
// Shared Firestore double — same shape as `reviewConversionResolution.test.ts`,
// plus a record of which collections were ever opened (§10.1 needs that).
// ---------------------------------------------------------------------------

const AI_RESOLUTIONS_COLLECTION = "aiResolutions";
const PATTERN_ID = "pattern-1";
const RESOLUTION_ID = "resolution-1";
const OCCURRENCE_KEY = "conversionFailures/occ-1";
const PATTERN_KEY = "failurePatterns/pattern-1";
const ADMIN_UID = "admin-uid-1";

interface MockDocSnapshot {
  readonly exists: boolean;
  readonly id: string;
  data(): unknown;
}

interface MockDocRef {
  readonly id: string;
  readonly path: string;
  get(): Promise<MockDocSnapshot>;
  set(data: unknown): Promise<void>;
}

interface MockTransaction {
  get(ref: MockDocRef): Promise<MockDocSnapshot>;
  set(ref: MockDocRef, data: unknown): void;
}

function createMockDb(seed: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(seed));
  const openedCollections: string[] = [];

  function makeDocRef(docPath: string): MockDocRef {
    const id = docPath.split("/").pop()!;
    return {
      id,
      path: docPath,
      async get() {
        const data = store.get(docPath);
        return { exists: data !== undefined, id, data: () => data };
      },
      async set(data: unknown) {
        store.set(docPath, data);
      },
    };
  }

  return {
    store,
    openedCollections,
    collection(name: string) {
      openedCollections.push(name);
      return { doc: (docId: string) => makeDocRef(`${name}/${docId}`) };
    },
    async runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T> {
      const tx: MockTransaction = {
        get: (ref) => ref.get(),
        set: (ref, data) => {
          store.set(ref.path, data);
        },
      };
      return fn(tx);
    },
  };
}

function asFirestore(db: ReturnType<typeof createMockDb>): ReturnType<typeof getAdminDb> {
  return db as unknown as ReturnType<typeof getAdminDb>;
}

/** The engine's own (imperfect) output — deliberately different from the AI candidate below. */
const ENGINE_OUTPUT = "engine-output-mojibake";
const FAILED_SEQUENCE = "Av";
const AI_CANDIDATE = "আ";

function makeOccurrence(): ConversionFailure {
  return {
    userId: null,
    sessionId: "session-1",
    source: "text",
    encodingId: "bijoy",
    engineVersion: "engine-1.2.3",
    rulesHash: "rules-abc",
    failureCategory: "unmapped_character",
    failedSequence: FAILED_SEQUENCE,
    codePoints: [65, 118],
    occurrenceCount: 1,
    position: 12,
    contextBefore: "before",
    contextAfter: "after",
    fullText: "before Av after",
    fullTextTruncated: false,
    engineOutput: ENGINE_OUTPUT,
    errorCode: "CONVERSION_ERROR",
    errorReason: "Unmapped legacy sequence.",
    severity: "warning",
    fileName: null,
    fileType: null,
    route: null,
    patternId: PATTERN_ID,
    createdAt: "2026-01-02T00:00:00.000Z",
  };
}

function makePattern(): FailurePattern {
  return {
    encodingId: "bijoy",
    engineVersion: "engine-1.2.3",
    failedSequence: FAILED_SEQUENCE,
    failureCategory: "unmapped_character",
    occurrenceCount: 3,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-02T00:00:00.000Z",
    sampleOccurrenceIds: ["occ-1"],
    status: "open",
  };
}

function makeCompletedResolution(): AiResolution {
  return {
    patternId: PATTERN_ID,
    encodingId: "bijoy",
    failedSequence: "Av",
    lookupKey: "lookup-key-1",
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: "v1",
    engineVersion: "engine-1.2.3",
    rulesHash: "rules-abc",
    candidateConversion: AI_CANDIDATE,
    reasoningSummary: "Matches a known Bijoy cluster.",
    confidence: "high",
    alternativeCandidates: ["আা"],
    isCertain: true,
    rawResponse: null,
    status: "completed",
    hitCount: 0,
    lastUsedAt: null,
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-01-02T00:00:00.000Z",
  };
}

/** Seeds the original evidence alongside a reviewable candidate, then accepts it. */
async function acceptCandidate() {
  const occurrence = makeOccurrence();
  const pattern = makePattern();
  const db = createMockDb({
    [OCCURRENCE_KEY]: occurrence,
    [PATTERN_KEY]: pattern,
    [`${AI_RESOLUTIONS_COLLECTION}/${RESOLUTION_ID}`]: makeCompletedResolution(),
  });
  vi.mocked(getAdminDb).mockReturnValue(asFirestore(db));
  vi.mocked(getFailurePatternById).mockResolvedValue({ id: PATTERN_ID, ...pattern } as WithId<FailurePattern>);

  const result = await reviewConversionResolution({
    patternId: PATTERN_ID,
    resolutionId: RESOLUTION_ID,
    decision: "accepted",
    reviewedBy: ADMIN_UID,
  });

  return { db, result, originalOccurrence: occurrence, originalPattern: pattern };
}

beforeEach(() => {
  vi.mocked(getAdminDb).mockReset();
  vi.mocked(getFailurePatternById).mockReset();
});

// ---------------------------------------------------------------------------
// §10.1 — the original evidence is never overwritten by an AI candidate
// ---------------------------------------------------------------------------

/** Guards every static scan below from passing vacuously if a directory is ever moved or renamed. */
describe("the static scans below actually see the pipeline's source", () => {
  it("finds shipped sources in both scanned directories", () => {
    expect(listShippedSources(AI_LIB_DIR).length).toBeGreaterThan(0);
    expect(listShippedSources(ADMIN_ROUTE_DIR).length).toBeGreaterThan(0);
  });
});

describe("§10.1 an AI candidate never overwrites engineOutput or failedSequence", () => {
  it("gives a stored resolution no field it could write engineOutput into", () => {
    const parsed = aiResolutionSchema.parse({
      ...makeCompletedResolution(),
      engineOutput: "overwritten",
    });
    expect(parsed).not.toHaveProperty("engineOutput");
  });

  it("writes failedSequence from the pattern, never from the provider result", () => {
    // Phase 4 put `failedSequence` on the resolution document, because the
    // lookup key needs it (docs/phase-4-resolution-store.md). That weakens
    // the older form of this invariant — "the schema has nowhere to put it"
    // — so the guarantee is re-stated where it now lives: the value is
    // copied server-side from the authoritative `FailurePattern`, and the
    // provider's normalized result (`resolution`, `providerCallResult`)
    // may not reach it.
    const source = readFileSync(path.join(AI_LIB_DIR, "resolveConversionFailure.ts"), "utf8");
    const assignments = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("failedSequence:"));

    expect(
      assignments.length,
      "no failedSequence assignment found — has the writer moved?",
    ).toBeGreaterThan(0);

    // The only sources allowed are the stored pattern and the pending
    // record already built from it. Anything derived from the provider
    // response fails here.
    const allowed = ["failedSequence: pattern.failedSequence", "failedSequence: pendingRecord.failedSequence"];
    for (const assignment of assignments) {
      expect(
        allowed.some((prefix) => assignment.startsWith(prefix)),
        `failedSequence assigned from something other than the stored pattern: ${assignment}`,
      ).toBe(true);
    }
  });

  it("leaves the occurrence and pattern documents byte-for-byte unchanged when a candidate is accepted", async () => {
    const { db, result, originalOccurrence, originalPattern } = await acceptCandidate();

    expect(result.ok).toBe(true);
    expect(db.store.get(OCCURRENCE_KEY)).toStrictEqual(originalOccurrence);
    expect(db.store.get(PATTERN_KEY)).toStrictEqual(originalPattern);
  });

  it("keeps the candidate and the original engine output side by side, still distinct, after acceptance", async () => {
    const { db, result } = await acceptCandidate();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const occurrence = db.store.get(OCCURRENCE_KEY) as ConversionFailure;
    expect(occurrence.engineOutput).toBe(ENGINE_OUTPUT);
    expect(occurrence.failedSequence).toBe(FAILED_SEQUENCE);
    expect(result.value.resolution.candidateConversion).toBe(AI_CANDIDATE);
    // A wrong AI answer stays exactly as visible as a right one.
    expect(result.value.resolution.candidateConversion).not.toBe(occurrence.engineOutput);
  });

  it("opens only the aiResolutions collection during a review", async () => {
    const { db } = await acceptCandidate();
    expect([...new Set(db.openedCollections)]).toStrictEqual([AI_RESOLUTIONS_COLLECTION]);
  });

  it("names no failure-evidence collection as a write target anywhere in lib/ai", () => {
    for (const file of listShippedSources(AI_LIB_DIR)) {
      const contents = readFileSync(file, "utf8");
      expect(contents, `${file} must not target the conversionFailures collection`).not.toMatch(
        /["'`]conversionFailures["'`]/,
      );
      expect(contents, `${file} must not target the failurePatterns collection`).not.toMatch(
        /["'`]failurePatterns["'`]/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// §10.2 — full document text is never automatically transmitted
// ---------------------------------------------------------------------------

const SENTINEL_FULL_TEXT = "SENTINEL_FULL_DOCUMENT_TEXT_never_auto_sent";
const SENTINEL_CONTEXT_BEFORE = "SENTINEL_CONTEXT_BEFORE_never_auto_sent";
const SENTINEL_CONTEXT_AFTER = "SENTINEL_CONTEXT_AFTER_never_auto_sent";

/** Carries every optional field a provider *could* transmit, so an accidental widening of the defaults shows up here. */
const loadedRequest: ConversionResolutionRequest = {
  failurePatternId: PATTERN_ID,
  encodingId: "bijoy",
  failedSequence: FAILED_SEQUENCE,
  codePoints: [65, 118],
  contextBefore: SENTINEL_CONTEXT_BEFORE,
  contextAfter: SENTINEL_CONTEXT_AFTER,
  fullText: SENTINEL_FULL_TEXT,
  position: 12,
  currentEngineOutput: ENGINE_OUTPUT,
  failureCategory: "unmapped_character",
  engineVersion: "engine-1.2.3",
  rulesHash: "rules-abc",
};

const VALID_PROVIDER_JSON = JSON.stringify({
  candidateConversion: AI_CANDIDATE,
  alternatives: [],
  confidence: "high",
  isCertain: true,
  explanation: "ok",
});

function geminiResponse(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as Response;
}

function openAiResponse(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  } as Response;
}

/** Returns the exact request body the adapter put on the wire. */
async function captureOutboundBody(provider: "gemini" | "openai", options?: ResolutionOptions): Promise<string> {
  vi.resetModules();
  vi.stubEnv(provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY", "test-key");

  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      provider === "gemini" ? geminiResponse(VALID_PROVIDER_JSON) : openAiResponse(VALID_PROVIDER_JSON),
    );
  global.fetch = fetchMock as unknown as typeof fetch;

  if (provider === "gemini") {
    const { geminiProvider } = await import("../providers/gemini");
    await geminiProvider.resolve(loadedRequest, options);
  } else {
    const { openAiProvider } = await import("../providers/openai");
    await openAiProvider.resolve(loadedRequest, options);
  }

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return String(init?.body ?? "");
}

describe("§10.2 full document text is never sent to a provider automatically", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  for (const provider of ["gemini", "openai"] as const) {
    it(`omits fullText and context from the ${provider} request body by default`, async () => {
      const body = await captureOutboundBody(provider);

      expect(body).not.toContain(SENTINEL_FULL_TEXT);
      expect(body).not.toContain(SENTINEL_CONTEXT_BEFORE);
      expect(body).not.toContain(SENTINEL_CONTEXT_AFTER);
      // ...while still sending what the resolution actually needs.
      expect(body).toContain(FAILED_SEQUENCE);
    });

    it(`sends fullText and context to ${provider} only on an explicit opt-in`, async () => {
      const body = await captureOutboundBody(provider, { includeContext: true, includeFullText: true });

      expect(body).toContain(SENTINEL_FULL_TEXT);
      expect(body).toContain(SENTINEL_CONTEXT_BEFORE);
      expect(body).toContain(SENTINEL_CONTEXT_AFTER);
    });
  }
});

// ---------------------------------------------------------------------------
// §10.3 — mapping tables are never edited by this pipeline
// ---------------------------------------------------------------------------

function hashEncodingTables(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const entry of readdirSync(ENCODINGS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const mapFile = path.join(ENCODINGS_DIR, entry.name, "map.ts");
    try {
      if (!statSync(mapFile).isFile()) continue;
    } catch {
      continue;
    }
    hashes[entry.name] = createHash("sha256").update(readFileSync(mapFile)).digest("hex");
  }
  return hashes;
}

describe("§10.3 the pipeline never edits features/converter/encodings/*/map.ts", () => {
  it("has mapping tables to guard", () => {
    expect(Object.keys(hashEncodingTables()).length).toBeGreaterThan(0);
  });

  it("leaves every mapping table untouched when a candidate is accepted", async () => {
    const before = hashEncodingTables();
    const { result } = await acceptCandidate();

    expect(result.ok).toBe(true);
    expect(hashEncodingTables()).toStrictEqual(before);
  });

  it("gives no pipeline module the means to write a file at all", () => {
    for (const dir of [AI_LIB_DIR, ADMIN_ROUTE_DIR]) {
      for (const file of listShippedSources(dir)) {
        const contents = readFileSync(file, "utf8");
        expect(contents, `${file} must not import a filesystem module`).not.toMatch(
          /from\s+["'](?:node:)?fs(?:\/promises)?["']/,
        );
        expect(contents, `${file} must not reach into the encoding tables`).not.toMatch(
          /features\/converter\/encodings/,
        );
      }
    }
  });
});
