import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Same minimal in-memory Firestore double as `resolveConversionFailure.test.ts`
 * (no existing precedent mocks `getAdminDb`/transactions beyond that file) —
 * `collection().doc(id)` → `{id, get(), set()}`, and `runTransaction(fn)` → a
 * `tx` reading/writing the same underlying map, optionally rejecting to
 * exercise the "transaction itself fails" path.
 */
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/firebase/conversionFailures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/firebase/conversionFailures")>();
  return { ...actual, getFailurePatternById: vi.fn() };
});

import { getAdminDb } from "@/lib/firebase/admin";
import { getFailurePatternById, type WithId } from "@/lib/firebase/conversionFailures";
import type { AiResolution, FailurePattern } from "@/lib/firebase/schemas";
import { reviewConversionResolution } from "./reviewConversionResolution";

const AI_RESOLUTIONS_COLLECTION = "aiResolutions";
const PATTERN_ID = "pattern-1";
const RESOLUTION_ID = "resolution-1";
const ADMIN_UID = "admin-uid-1";
const OTHER_ADMIN_UID = "admin-uid-2";

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

function createMockDb(options: { seed?: Record<string, unknown>; throwOnTransaction?: boolean } = {}) {
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
      if (options.throwOnTransaction) throw new Error("simulated Firestore transaction failure");
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

function makeStoredPattern(pattern: FailurePattern = makePattern()): WithId<FailurePattern> {
  return { id: PATTERN_ID, ...pattern };
}

function makeResolution(overrides: Partial<AiResolution> = {}): AiResolution {
  return {
    patternId: PATTERN_ID,
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: "v1",
    engineVersion: "engine-1.2.3",
    rulesHash: "rules-abc",
    candidateConversion: "é",
    reasoningSummary: "Matches a known accented-character mapping.",
    confidence: "high",
    alternativeCandidates: ["è"],
    isCertain: true,
    rawResponse: null,
    status: "completed",
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function seedWith(resolution: AiResolution): Record<string, unknown> {
  return { [`${AI_RESOLUTIONS_COLLECTION}/${RESOLUTION_ID}`]: resolution };
}

const baseInput = {
  patternId: PATTERN_ID,
  resolutionId: RESOLUTION_ID,
  decision: "accepted" as const,
  reviewedBy: ADMIN_UID,
};

beforeEach(() => {
  vi.mocked(getAdminDb).mockReset();
  vi.mocked(getFailurePatternById).mockReset();
});

describe("reviewConversionResolution — pattern loading", () => {
  it("returns NOT_FOUND_ERROR when the failure pattern does not exist, without touching aiResolutions", async () => {
    vi.mocked(getFailurePatternById).mockResolvedValue(null);
    const mockDb = createMockDb({ seed: seedWith(makeResolution()) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND_ERROR");
    // Untouched — proves the pattern check short-circuits before any resolution write.
    expect(mockDb.store.get(`${AI_RESOLUTIONS_COLLECTION}/${RESOLUTION_ID}`)).toEqual(makeResolution());
  });

  it("returns DATABASE_ERROR when loading the failure pattern throws", async () => {
    vi.mocked(getFailurePatternById).mockRejectedValue(new Error("boom"));
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    const result = await reviewConversionResolution(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_ERROR");
  });
});

describe("reviewConversionResolution — resource validation", () => {
  beforeEach(() => {
    vi.mocked(getFailurePatternById).mockResolvedValue(makeStoredPattern());
  });

  it("returns NOT_FOUND_ERROR when no aiResolutions document exists at resolutionId", async () => {
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(createMockDb()));

    const result = await reviewConversionResolution(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND_ERROR");
  });

  it("returns NOT_FOUND_ERROR for a malformed resolution document instead of crashing", async () => {
    const mockDb = createMockDb({
      seed: { [`${AI_RESOLUTIONS_COLLECTION}/${RESOLUTION_ID}`]: { garbage: true } },
    });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND_ERROR");
  });

  it("returns NOT_FOUND_ERROR (not a cross-pattern leak) when the resolution belongs to a different pattern", async () => {
    const mockDb = createMockDb({ seed: seedWith(makeResolution({ patternId: "some-other-pattern" })) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND_ERROR");
      // The error must not confirm the resolution exists under a different pattern.
      expect(result.error.message).not.toMatch(/some-other-pattern/);
    }
  });
});

describe("reviewConversionResolution — state transitions", () => {
  beforeEach(() => {
    vi.mocked(getFailurePatternById).mockResolvedValue(makeStoredPattern());
  });

  it("pending review + accept -> accepted, recording reviewer and timestamp server-side", async () => {
    const mockDb = createMockDb({ seed: seedWith(makeResolution({ status: "completed" })) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution({ ...baseInput, decision: "accepted", reviewNote: "Looks right." });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.alreadyReviewed).toBe(false);
    expect(result.value.resolution.status).toBe("reviewed");
    expect(result.value.resolution.reviewDecision).toBe("accepted");
    expect(result.value.resolution.reviewedBy).toBe(ADMIN_UID);
    expect(typeof result.value.resolution.reviewedAt).toBe("string");
    expect(result.value.resolution.reviewNote).toBe("Looks right.");
  });

  it("pending review + reject -> rejected", async () => {
    const mockDb = createMockDb({ seed: seedWith(makeResolution({ status: "completed" })) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution({ ...baseInput, decision: "rejected" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution.status).toBe("reviewed");
    expect(result.value.resolution.reviewDecision).toBe("rejected");
  });

  it("defaults reviewNote to null when omitted", async () => {
    const mockDb = createMockDb({ seed: seedWith(makeResolution({ status: "completed" })) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution.reviewNote).toBeNull();
  });

  it("accepted -> rejected is a CONFLICT_ERROR and leaves the stored record unchanged", async () => {
    const original = makeResolution({
      status: "reviewed",
      reviewDecision: "accepted",
      reviewedBy: OTHER_ADMIN_UID,
      reviewedAt: "2026-01-03T00:00:00.000Z",
    });
    const mockDb = createMockDb({ seed: seedWith(original) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution({ ...baseInput, decision: "rejected" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT_ERROR");
    expect(mockDb.store.get(`${AI_RESOLUTIONS_COLLECTION}/${RESOLUTION_ID}`)).toEqual(original);
  });

  it("rejected -> accepted is a CONFLICT_ERROR", async () => {
    const original = makeResolution({ status: "reviewed", reviewDecision: "rejected", reviewedBy: OTHER_ADMIN_UID, reviewedAt: "2026-01-03T00:00:00.000Z" });
    const mockDb = createMockDb({ seed: seedWith(original) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution({ ...baseInput, decision: "accepted" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT_ERROR");
  });

  it("accepted -> accepted (same decision resubmitted) is treated as idempotent success, not a duplicate write", async () => {
    const original = makeResolution({
      status: "reviewed",
      reviewDecision: "accepted",
      reviewedBy: OTHER_ADMIN_UID,
      reviewedAt: "2026-01-03T00:00:00.000Z",
      reviewNote: "first reviewer's note",
    });
    const mockDb = createMockDb({ seed: seedWith(original) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution({ ...baseInput, decision: "accepted", reviewNote: "second reviewer trying to overwrite" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.alreadyReviewed).toBe(true);
    // Original reviewer/timestamp/note are preserved — a resubmission never overwrites who actually reviewed it first.
    expect(result.value.resolution.reviewedBy).toBe(OTHER_ADMIN_UID);
    expect(result.value.resolution.reviewedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(result.value.resolution.reviewNote).toBe("first reviewer's note");
  });

  it("rejected -> rejected (same decision resubmitted) is also idempotent", async () => {
    const original = makeResolution({ status: "reviewed", reviewDecision: "rejected", reviewedBy: OTHER_ADMIN_UID, reviewedAt: "2026-01-03T00:00:00.000Z" });
    const mockDb = createMockDb({ seed: seedWith(original) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution({ ...baseInput, decision: "rejected" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.alreadyReviewed).toBe(true);
  });

  it.each(["pending", "failed"] as const)(
    "status %s (never a completed candidate) is not reviewable -> CONFLICT_ERROR",
    async (status) => {
      const mockDb = createMockDb({ seed: seedWith(makeResolution({ status })) });
      vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

      const result = await reviewConversionResolution(baseInput);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("CONFLICT_ERROR");
    },
  );

  it("returns DATABASE_ERROR when the Firestore transaction itself fails", async () => {
    const mockDb = createMockDb({ seed: seedWith(makeResolution({ status: "completed" })), throwOnTransaction: true });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_ERROR");
  });
});

describe("reviewConversionResolution — data preservation", () => {
  it("leaves every original AI-resolution field untouched by an accept/reject decision", async () => {
    vi.mocked(getFailurePatternById).mockResolvedValue(makeStoredPattern());
    const original = makeResolution({ status: "completed" });
    const mockDb = createMockDb({ seed: seedWith(original) });
    vi.mocked(getAdminDb).mockReturnValue(asFirestore(mockDb));

    const result = await reviewConversionResolution({ ...baseInput, decision: "accepted" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { resolution } = result.value;
    expect(resolution.provider).toBe(original.provider);
    expect(resolution.model).toBe(original.model);
    expect(resolution.promptVersion).toBe(original.promptVersion);
    expect(resolution.engineVersion).toBe(original.engineVersion);
    expect(resolution.rulesHash).toBe(original.rulesHash);
    expect(resolution.candidateConversion).toBe(original.candidateConversion);
    expect(resolution.confidence).toBe(original.confidence);
    expect(resolution.alternativeCandidates).toEqual(original.alternativeCandidates);
    expect(resolution.isCertain).toBe(original.isCertain);
    expect(resolution.rawResponse).toBeNull();
    expect(resolution.createdAt).toBe(original.createdAt);
  });
});
