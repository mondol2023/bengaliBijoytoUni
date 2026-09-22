import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * No existing test in this codebase mocks `getAdminDb`/Firestore transactions
 * (confirmed by grepping `**\/*.test.ts` for `getAdminDb|runTransaction`), so
 * this file defines its own minimal in-memory Firestore double rather than
 * following a precedent. It only implements the surface
 * `resolveConversionFailure.ts` actually calls: `collection().doc(id)` →
 * `{id, get(), set()}`, and `runTransaction(fn)` → a `tx` that reads/writes
 * the same underlying map, so a claim made inside a transaction is visible to
 * a later direct `docRef.set()` and vice versa.
 */
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/firebase/conversionFailures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/firebase/conversionFailures")>();
  return { ...actual, getFailurePatternDetail: vi.fn() };
});

vi.mock("@/lib/ai/registry", () => ({
  getResolutionProvider: vi.fn(),
}));

import { getAdminDb } from "@/lib/firebase/admin";
import { getFailurePatternDetail, type FailurePatternDetail, type WithId } from "@/lib/firebase/conversionFailures";
import { getResolutionProvider } from "@/lib/ai/registry";
import type { AiResolution, ConversionFailure, FailurePattern } from "@/lib/firebase/schemas";
import { computeResolutionKey, resolveConversionFailure } from "./resolveConversionFailure";
import { CONVERSION_RESOLUTION_PROMPT_VERSION } from "./promptBuilder";
import { RESOLUTION_LIMITS } from "./limits";
import { ProviderErrors, type ProviderError, type ProviderErrorCode } from "./errors";
import {
  providerOk,
  providerErr,
  type ConversionResolution,
  type ConversionResolutionProvider,
  type ConversionResolutionRequest,
  type ResolutionOptions,
} from "./types";

const AI_RESOLUTIONS_COLLECTION = "aiResolutions";
const PATTERN_ID = "pattern-1";

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

function createMockDb(options: { seed?: Record<string, unknown>; throwOnDirectSet?: boolean } = {}) {
  const store = new Map<string, unknown>(Object.entries(options.seed ?? {}));

  function makeDocRef(path: string): MockDocRef {
    const id = path.split("/").pop()!;
    return {
      id,
      path,
      async get() {
        const data = store.get(path);
        return { exists: data !== undefined, id, data: () => data };
      },
      async set(data: unknown) {
        if (options.throwOnDirectSet) throw new Error("simulated Firestore write failure");
        store.set(path, data);
      },
    };
  }

  return {
    store,
    collection(name: string) {
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

function makePattern(overrides: Partial<FailurePattern> = {}): FailurePattern {
  return {
    encodingId: "cp1251",
    engineVersion: "engine-1.2.3",
    failedSequence: "�",
    failureCategory: "unmapped_character",
    occurrenceCount: 3,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-02T00:00:00.000Z",
    sampleOccurrenceIds: ["occ-1"],
    status: "open",
    ...overrides,
  };
}

function makeOccurrence(overrides: Partial<WithId<ConversionFailure>> = {}): WithId<ConversionFailure> {
  return {
    id: "occ-1",
    userId: "user-1",
    sessionId: "session-1",
    source: "text",
    encodingId: "cp1251",
    engineVersion: "engine-1.2.3",
    rulesHash: "rules-abc",
    failureCategory: "unmapped_character",
    failedSequence: "�",
    codePoints: [0xfffd],
    occurrenceCount: 1,
    position: 10,
    contextBefore: "before-context",
    contextAfter: "after-context",
    fullText: "the full original text",
    fullTextTruncated: false,
    engineOutput: "?",
    errorCode: "UNMAPPED",
    errorReason: "No mapping found",
    severity: "error",
    fileName: null,
    fileType: null,
    route: "/api/convert",
    patternId: PATTERN_ID,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeDetail(pattern: FailurePattern, occurrences: WithId<ConversionFailure>[]): FailurePatternDetail {
  return { pattern: { id: PATTERN_ID, ...pattern }, occurrences };
}

function makeProvider(overrides: Partial<ConversionResolutionProvider> = {}): ConversionResolutionProvider {
  return {
    id: "gemini",
    model: "gemini-2.0-flash",
    isConfigured: () => true,
    resolve: vi.fn(),
    ...overrides,
  };
}

function makeSuccessfulResolution(overrides: Partial<ConversionResolution> = {}): ConversionResolution {
  return {
    candidateConversion: "é",
    alternatives: ["è"],
    confidence: "high",
    isCertain: true,
    explanation: "Matches a known accented-character mapping.",
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: CONVERSION_RESOLUTION_PROMPT_VERSION,
    engineVersion: "engine-1.2.3",
    rulesHash: "rules-abc",
    ...overrides,
  };
}

function makePendingRecord(overrides: Partial<AiResolution> = {}): AiResolution {
  return {
    patternId: PATTERN_ID,
    encodingId: "bijoy",
    failedSequence: "Av",
    lookupKey: "lookup-key-1",
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: CONVERSION_RESOLUTION_PROMPT_VERSION,
    engineVersion: "engine-1.2.3",
    rulesHash: "rules-abc",
    candidateConversion: null,
    reasoningSummary: null,
    confidence: "unknown",
    alternativeCandidates: [],
    isCertain: false,
    rawResponse: null,
    hitCount: 0,
    lastUsedAt: null,
    status: "pending",
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const baseInput = {
  patternId: PATTERN_ID,
  providerId: "gemini" as const,
  includeContext: false,
  includeFullText: false,
};

const defaultKey = () =>
  computeResolutionKey({
    patternId: PATTERN_ID,
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: CONVERSION_RESOLUTION_PROMPT_VERSION,
    engineVersion: "engine-1.2.3",
    rulesHash: "rules-abc",
  });

beforeEach(() => {
  vi.mocked(getAdminDb).mockReset();
  vi.mocked(getFailurePatternDetail).mockReset();
  vi.mocked(getResolutionProvider).mockReset();
});

describe("resolveConversionFailure — pattern/occurrence loading", () => {
  it("returns a NOT_FOUND_ERROR when no failure pattern exists for the given id", async () => {
    const provider = makeProvider();
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(null);
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND_ERROR");
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it("returns a DATABASE_ERROR when loading the failure pattern throws", async () => {
    const provider = makeProvider();
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockRejectedValue(new Error("boom"));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_ERROR");
  });

  it("returns a DATABASE_ERROR when the pattern has no occurrence records to resolve from", async () => {
    const provider = makeProvider();
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), []));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_ERROR");
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it("uses the most recent occurrence to build the request when a pattern has several", async () => {
    const resolveSpy = vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution({ rulesHash: "rules-newest" })));
    const provider = makeProvider({ resolve: resolveSpy });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    const newest = makeOccurrence({ id: "occ-newest", rulesHash: "rules-newest", createdAt: "2026-01-05T00:00:00.000Z" });
    const older = makeOccurrence({ id: "occ-older", rulesHash: "rules-older", createdAt: "2026-01-01T00:00:00.000Z" });
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [newest, older]));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    await resolveConversionFailure(baseInput);

    const [request] = resolveSpy.mock.calls[0] as [ConversionResolutionRequest, ResolutionOptions];
    expect(request.rulesHash).toBe("rules-newest");
  });
});

describe("resolveConversionFailure — provider errors", () => {
  it("maps a provider_not_registered registry lookup failure to a VALIDATION_ERROR without touching Firestore", async () => {
    vi.mocked(getResolutionProvider).mockReturnValue(providerErr(ProviderErrors.notRegistered("gemini")));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(getFailurePatternDetail).not.toHaveBeenCalled();
  });

  const providerErrorCases: Array<{ code: ProviderErrorCode; expectedAppCode: string; build: () => ProviderError }> = [
    { code: "provider_not_configured", expectedAppCode: "UNKNOWN_ERROR", build: () => ProviderErrors.notConfigured("gemini") },
    { code: "provider_authentication_failed", expectedAppCode: "UNKNOWN_ERROR", build: () => ProviderErrors.authenticationFailed("gemini") },
    { code: "provider_rate_limited", expectedAppCode: "RATE_LIMIT_ERROR", build: () => ProviderErrors.rateLimited("gemini", 30) },
    { code: "provider_timeout", expectedAppCode: "UNKNOWN_ERROR", build: () => ProviderErrors.timeout("gemini") },
    { code: "provider_unavailable", expectedAppCode: "UNKNOWN_ERROR", build: () => ProviderErrors.unavailable("gemini") },
    { code: "provider_invalid_response", expectedAppCode: "UNKNOWN_ERROR", build: () => ProviderErrors.invalidResponse("gemini") },
    { code: "provider_content_rejected", expectedAppCode: "VALIDATION_ERROR", build: () => ProviderErrors.contentRejected("gemini") },
    { code: "provider_unknown_error", expectedAppCode: "UNKNOWN_ERROR", build: () => ProviderErrors.unknown("gemini") },
  ];

  it.each(providerErrorCases)(
    "maps provider error $code to $expectedAppCode and persists a distinguishable 'failed' resolution record",
    async ({ expectedAppCode, build }) => {
      const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerErr(build())) });
      vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
      vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));
      const mockDb = createMockDb();
      vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

      const result = await resolveConversionFailure(baseInput);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(expectedAppCode);

      const persisted = mockDb.store.get(`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`) as AiResolution | undefined;
      expect(persisted).toBeDefined();
      expect(persisted?.status).toBe("failed");
      // Never the raw provider debug payload or an API-key-bearing value.
      expect(JSON.stringify(persisted)).not.toMatch(/api[_-]?key/i);
    },
  );
});

describe("resolveConversionFailure — successful resolution + persistence", () => {
  it("persists a completed resolution with every field mapped from the normalized provider result", async () => {
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));
    const mockDb = createMockDb();
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reused).toBe(false);

    const resolution = result.value.resolution;
    expect(resolution.patternId).toBe(PATTERN_ID);
    expect(resolution.provider).toBe("gemini");
    expect(resolution.model).toBe("gemini-2.0-flash");
    expect(resolution.promptVersion).toBe(CONVERSION_RESOLUTION_PROMPT_VERSION);
    expect(resolution.engineVersion).toBe("engine-1.2.3");
    expect(resolution.rulesHash).toBe("rules-abc");
    expect(resolution.candidateConversion).toBe("é");
    expect(resolution.reasoningSummary).toBe("Matches a known accented-character mapping.");
    expect(resolution.confidence).toBe("high");
    expect(resolution.alternativeCandidates).toEqual(["è"]);
    expect(resolution.isCertain).toBe(true);
    expect(resolution.rawResponse).toBeNull();
    expect(resolution.status).toBe("completed");
    expect(resolution.reviewDecision).toBeNull();
    expect(resolution.reviewedBy).toBeNull();
    expect(resolution.reviewedAt).toBeNull();
    expect(resolution.reviewNote).toBeNull();
    expect(typeof resolution.createdAt).toBe("string");
    expect(typeof resolution.id).toBe("string");

    expect(mockDb.store.get(`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`)).toBeDefined();
  });

  it("maps a null candidateConversion/confidence to a real, meaningful 'unknown' result instead of guessing", async () => {
    const provider = makeProvider({
      resolve: vi
        .fn()
        .mockResolvedValue(providerOk(makeSuccessfulResolution({ candidateConversion: null, confidence: null, isCertain: false }))),
    });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution.candidateConversion).toBeNull();
    expect(result.value.resolution.confidence).toBe("unknown");
  });

  it("returns a DATABASE_ERROR distinct from a provider failure when Firestore write fails after a successful AI response", async () => {
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb({ throwOnDirectSet: true })));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DATABASE_ERROR");
      expect(result.error.message).toMatch(/could not be saved/i);
    }
    expect(provider.resolve).toHaveBeenCalledTimes(1);
  });
});

describe("resolveConversionFailure — deduplication and concurrency", () => {
  it("reuses an existing completed resolution at the same dedup key instead of calling the provider again", async () => {
    const provider = makeProvider({ resolve: vi.fn() });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));

    const existing = makePendingRecord({ status: "completed", reasoningSummary: "cached", createdAt: "2026-01-01T00:00:00.000Z" });
    const mockDb = createMockDb({ seed: { [`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`]: existing } });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reused).toBe(true);
    expect(result.value.resolution.reasoningSummary).toBe("cached");
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it("does not reuse a completed resolution stored under a different dedup key (e.g. a rulesHash drift)", async () => {
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));

    const staleKey = computeResolutionKey({
      patternId: PATTERN_ID,
      provider: "gemini",
      model: "gemini-2.0-flash",
      promptVersion: CONVERSION_RESOLUTION_PROMPT_VERSION,
      engineVersion: "engine-1.2.3",
      rulesHash: "old-rules-hash",
    });
    const stale = makePendingRecord({ status: "completed", rulesHash: "old-rules-hash", createdAt: "2026-01-01T00:00:00.000Z" });
    const mockDb = createMockDb({ seed: { [`${AI_RESOLUTIONS_COLLECTION}/${staleKey}`]: stale } });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reused).toBe(false);
    expect(provider.resolve).toHaveBeenCalledTimes(1);
  });

  it("returns a CONFLICT_ERROR when a fresh pending claim already exists at the same dedup key", async () => {
    const provider = makeProvider({ resolve: vi.fn() });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));

    const fresh = makePendingRecord({ status: "pending", createdAt: new Date().toISOString() });
    const mockDb = createMockDb({ seed: { [`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`]: fresh } });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT_ERROR");
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it("reclaims a stale pending claim past the timeout and proceeds to call the provider", async () => {
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));

    const staleCreatedAt = new Date(Date.now() - RESOLUTION_LIMITS.pendingClaimTimeoutMs - 1_000).toISOString();
    const stalePending = makePendingRecord({ status: "pending", createdAt: staleCreatedAt });
    const mockDb = createMockDb({ seed: { [`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`]: stalePending } });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reused).toBe(false);
    expect(provider.resolve).toHaveBeenCalledTimes(1);
  });

  it("tolerates a malformed/legacy document at the dedup key without crashing, and reclaims it", async () => {
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));

    const mockDb = createMockDb({
      seed: { [`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`]: { garbage: true, missingEverything: "yes" } },
    });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution.status).toBe("completed");
  });
});

describe("resolveConversionFailure — privacy defaults", () => {
  it("omits contextBefore/contextAfter/fullText from the provider request unless explicitly opted in", async () => {
    const resolveSpy = vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution()));
    const provider = makeProvider({ resolve: resolveSpy });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    await resolveConversionFailure(baseInput);

    const [request] = resolveSpy.mock.calls[0] as [ConversionResolutionRequest, ResolutionOptions];
    expect(request.contextBefore).toBeUndefined();
    expect(request.contextAfter).toBeUndefined();
    expect(request.fullText).toBeUndefined();
  });

  it("includes contextBefore/contextAfter/fullText in the provider request only when explicitly opted in", async () => {
    const resolveSpy = vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution()));
    const provider = makeProvider({ resolve: resolveSpy });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    await resolveConversionFailure({ ...baseInput, includeContext: true, includeFullText: true });

    const [request] = resolveSpy.mock.calls[0] as [ConversionResolutionRequest, ResolutionOptions];
    expect(request.contextBefore).toBe("before-context");
    expect(request.contextAfter).toBe("after-context");
    expect(request.fullText).toBe("the full original text");
  });
});

describe("resolveConversionFailure — the Phase 4 lookup key", () => {
  it("stamps encodingId, failedSequence and lookupKey from the authoritative pattern", async () => {
    // Denormalized so serving is one equality query rather than a join back
    // through patternId — and taken from the pattern, never from the
    // caller, which sends only a patternId and a provider id.
    const { computeResolutionLookupKey } = await import("@/lib/conversionFailures/resolutionLookup");
    const pattern = makePattern();
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(pattern, [makeOccurrence()]));
    const mockDb = createMockDb();
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    await resolveConversionFailure(baseInput);

    const persisted = mockDb.store.get(`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`) as
      | AiResolution
      | undefined;
    expect(persisted?.encodingId).toBe(pattern.encodingId);
    expect(persisted?.failedSequence).toBe(pattern.failedSequence);
    expect(persisted?.lookupKey).toBe(
      computeResolutionLookupKey({
        encodingId: pattern.encodingId,
        failedSequence: pattern.failedSequence,
      }),
    );
  });

  it("gives two patterns that differ only in engine version the same lookup key", async () => {
    // The whole reason the key is not patternId: a human's acceptance must
    // survive an engine bump.
    const { computeResolutionLookupKey } = await import("@/lib/conversionFailures/resolutionLookup");
    const a = makePattern({ engineVersion: "engine-1.2.3" });
    const b = makePattern({ engineVersion: "engine-9.9.9" });
    expect(computeResolutionLookupKey(a)).toBe(computeResolutionLookupKey(b));
  });
});

describe("resolveConversionFailure — usage counters survive a reclaim", () => {
  it("carries hitCount and lastUsedAt forward when a stale slot is reclaimed", async () => {
    // Reclaiming rewrites the whole document with `set`. Without the carry
    // forward, re-running the resolver on a resolution that had been served
    // a thousand times would silently reset its rank to zero.
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));

    const staleCreatedAt = new Date(Date.now() - RESOLUTION_LIMITS.pendingClaimTimeoutMs - 1_000).toISOString();
    const used = {
      ...makePendingRecord({ status: "pending", createdAt: staleCreatedAt }),
      hitCount: 1234,
      lastUsedAt: "2026-09-20T00:00:00.000Z",
    };
    const mockDb = createMockDb({ seed: { [`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`]: used } });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution.hitCount).toBe(1234);
    expect(result.value.resolution.lastUsedAt).toBe("2026-09-20T00:00:00.000Z");
  });

  it("starts a reclaimed malformed document from zero", async () => {
    // Nothing in an unparseable document is trustworthy, including a count.
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));

    const mockDb = createMockDb({
      seed: { [`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`]: { garbage: true, hitCount: 9_000_000 } },
    });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await resolveConversionFailure(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution.hitCount).toBe(0);
    expect(result.value.resolution.lastUsedAt).toBeNull();
  });

  it("gives a brand-new resolution a zero count rather than leaving it unset", async () => {
    const provider = makeProvider({ resolve: vi.fn().mockResolvedValue(providerOk(makeSuccessfulResolution())) });
    vi.mocked(getResolutionProvider).mockReturnValue(providerOk(provider));
    vi.mocked(getFailurePatternDetail).mockResolvedValue(makeDetail(makePattern(), [makeOccurrence()]));
    const mockDb = createMockDb();
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    await resolveConversionFailure(baseInput);

    const persisted = mockDb.store.get(`${AI_RESOLUTIONS_COLLECTION}/${defaultKey()}`) as AiResolution;
    expect(persisted.hitCount).toBe(0);
    expect(persisted.lastUsedAt).toBeNull();
  });
});
