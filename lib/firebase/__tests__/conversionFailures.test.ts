/**
 * The write half of batched reporting: a report that says a pattern occurred
 * forty-seven more times must move `occurrenceCount` by forty-seven.
 *
 * This is the assertion the whole batching change stands on. If the delta
 * were dropped and every report counted as one, the endpoint would look
 * healthy, the tests above it would pass, and the aggregate would quietly go
 * back to counting reports instead of occurrences — which is the bias the
 * change exists to remove.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** `FieldValue.increment` is opaque, so the double turns it into something assertable. */
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
  },
}));

vi.mock("../admin", () => ({ getAdminDb: vi.fn() }));

import { getAdminDb } from "../admin";
import { recordConversionFailures, type ConversionFailureInput } from "../conversionFailures";
import { __resetWriteMetricsForTests, getWriteMetricsSnapshot } from "../writeMetrics";
import { RETENTION_DAYS } from "@/lib/conversionFailures/retention";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Increment {
  __increment: number;
}

function isIncrement(value: unknown): value is Increment {
  return typeof value === "object" && value !== null && "__increment" in value;
}

function createMockDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(seed));
  let autoId = 0;

  function makeDocRef(collectionName: string, docId?: string) {
    const id = docId ?? `auto-${++autoId}`;
    const path = `${collectionName}/${id}`;
    return {
      id,
      path,
      async get() {
        const data = store.get(path);
        return { exists: data !== undefined, id, data: () => data };
      },
    };
  }

  type Ref = ReturnType<typeof makeDocRef>;

  return {
    store,
    collection(name: string) {
      return { doc: (docId?: string) => makeDocRef(name, docId) };
    },
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        get: (ref: Ref) => ref.get(),
        set: (ref: Ref, data: Record<string, unknown>) => {
          store.set(ref.path, data);
        },
        update: (ref: Ref, patch: Record<string, unknown>) => {
          const existing = store.get(ref.path) ?? {};
          const next = { ...existing };
          for (const [field, value] of Object.entries(patch)) {
            if (isIncrement(value)) {
              next[field] = ((existing[field] as number | undefined) ?? 0) + value.__increment;
            } else {
              next[field] = value;
            }
          }
          store.set(ref.path, next);
        },
      };
      return fn(tx);
    },
  };
}

function input(overrides: Partial<ConversionFailureInput> = {}): ConversionFailureInput {
  return {
    userId: null,
    sessionId: "session-1",
    source: "text",
    encodingId: "bijoy",
    engineVersion: "1.0.0",
    rulesHash: "aaaa1111",
    failureCategory: "unmapped_character",
    failedSequence: "Av",
    position: 0,
    contextBefore: "",
    contextAfter: "",
    engineOutput: null,
    errorCode: "UNMAPPED_CHARACTER",
    errorReason: "no rule",
    severity: "warning",
    fileName: null,
    fileType: null,
    route: null,
    ...overrides,
  };
}

function patterns(db: ReturnType<typeof createMockDb>) {
  return [...db.store.entries()].filter(([key]) => key.startsWith("failurePatterns/"));
}

function occurrences(db: ReturnType<typeof createMockDb>) {
  return [...db.store.entries()].filter(([key]) => key.startsWith("conversionFailures/"));
}

describe("recordConversionFailures: occurrence counts", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(getAdminDb).mockReturnValue(db as unknown as ReturnType<typeof getAdminDb>);
  });

  it("seeds a new pattern with the reported count, not with 1", async () => {
    await recordConversionFailures([input({ occurrenceCount: 47 })]);
    const [[, pattern]] = patterns(db);
    expect(pattern.occurrenceCount).toBe(47);
  });

  it("increments an existing pattern by the reported count", async () => {
    await recordConversionFailures([input({ occurrenceCount: 10 })]);
    await recordConversionFailures([input({ occurrenceCount: 37 })]);

    const [[, pattern]] = patterns(db);
    expect(pattern.occurrenceCount).toBe(47);
    // Two batches, two occurrence documents — the document count counts
    // batches, the aggregate counts occurrences.
    expect(occurrences(db)).toHaveLength(2);
  });

  it("treats an omitted count as one, so a pre-batching caller is unchanged", async () => {
    await recordConversionFailures([input()]);
    await recordConversionFailures([input()]);
    const [[, pattern]] = patterns(db);
    expect(pattern.occurrenceCount).toBe(2);
  });

  it("stores the count on the occurrence document too", async () => {
    await recordConversionFailures([input({ occurrenceCount: 12 })]);
    const [[, occurrence]] = occurrences(db);
    expect(occurrence.occurrenceCount).toBe(12);
  });

  it("clamps a count above the ceiling rather than trusting the caller", async () => {
    await recordConversionFailures([input({ occurrenceCount: 10_000_000 })]);
    const [[, pattern]] = patterns(db);
    expect(pattern.occurrenceCount).toBe(1000);
  });

  it("floors a count below one, so no report can decrement an aggregate", async () => {
    await recordConversionFailures([input({ occurrenceCount: 5 })]);
    await recordConversionFailures([input({ occurrenceCount: -100 })]);
    const [[, pattern]] = patterns(db);
    expect(pattern.occurrenceCount).toBe(6);
  });

  it("keeps distinct sequences in distinct patterns", async () => {
    await recordConversionFailures([
      input({ failedSequence: "Av", occurrenceCount: 3 }),
      input({ failedSequence: "Kv", occurrenceCount: 8 }),
    ]);
    expect(patterns(db)).toHaveLength(2);
    expect(
      patterns(db)
        .map(([, value]) => value.occurrenceCount)
        .sort((a, b) => Number(a) - Number(b)),
    ).toStrictEqual([3, 8]);
  });

  it("counts exactly two document writes per accepted report", async () => {
    __resetWriteMetricsForTests();
    await recordConversionFailures([input({ occurrenceCount: 500 })]);

    const snapshot = getWriteMetricsSnapshot();
    // Two documents whatever the occurrence count it carries — that ratio is
    // the number the caching question turns on.
    expect(snapshot.processTotal).toBe(2);
    const day = Object.values(snapshot.days)[0];
    expect(day.byCollection.conversionFailures.byOperation.create).toBe(1);
    expect(day.byCollection.failurePatterns.byOperation.create).toBe(1);
  });

  it("counts the second report against a pattern as an update, not a create", async () => {
    __resetWriteMetricsForTests();
    await recordConversionFailures([input()]);
    await recordConversionFailures([input()]);

    const day = Object.values(getWriteMetricsSnapshot().days)[0];
    expect(day.byCollection.failurePatterns.byOperation).toStrictEqual({ create: 1, update: 1 });
  });

  it("writes no whole-document field, whatever the batch size", async () => {
    await recordConversionFailures([input({ occurrenceCount: 500 })]);
    const [[, occurrence]] = occurrences(db);
    expect(occurrence.fullText).toBe("");
    expect(occurrence.fullTextTruncated).toBe(false);
    expect(occurrence.engineOutput).toBeNull();
  });
});

/**
 * A document written without `expireAt` is one the TTL policy will never
 * expire, and nothing about it looks wrong — it simply stays forever. So
 * what is asserted here is that the field reaches the document, on all
 * three write paths, as a `Date`.
 */
describe("recordConversionFailures: retention", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(getAdminDb).mockReturnValue(db as unknown as ReturnType<typeof getAdminDb>);
  });

  it("stamps an occurrence with its retention period", async () => {
    const before = Date.now();
    await recordConversionFailures([input()]);
    const [[, occurrence]] = occurrences(db);

    expect(occurrence.expireAt).toBeInstanceOf(Date);
    const expireAt = (occurrence.expireAt as Date).getTime();
    expect(expireAt).toBeGreaterThanOrEqual(before + RETENTION_DAYS.conversionFailures * DAY_MS);
  });

  it("stamps a newly created pattern with its own, longer period", async () => {
    await recordConversionFailures([input()]);
    const [[, pattern]] = patterns(db);

    expect(pattern.expireAt).toBeInstanceOf(Date);
    const [[, occurrence]] = occurrences(db);
    expect((pattern.expireAt as Date).getTime()).toBeGreaterThan(
      (occurrence.expireAt as Date).getTime(),
    );
  });

  it("pushes an existing pattern's expiry out on every new occurrence", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
      await recordConversionFailures([input()]);
      const first = (patterns(db)[0][1].expireAt as Date).getTime();

      vi.setSystemTime(new Date("2026-09-21T12:01:00.000Z"));
      await recordConversionFailures([input()]);
      const second = (patterns(db)[0][1].expireAt as Date).getTime();

      // Without this the aggregate would expire on the schedule of the first
      // occurrence ever seen, however active the pattern still is.
      expect(second).toBe(first + 60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The opportunistic half of "who decides resolved". The verdict comes from
 * re-running the engine over the sequence the server already stored — the
 * report that triggered it contributes the timing and nothing else.
 */
describe("recordConversionFailures: opportunistic re-verification", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(getAdminDb).mockReturnValue(db as unknown as ReturnType<typeof getAdminDb>);
  });

  /** A sequence no Bijoy rule matches, so the engine still fails on it. */
  const UNMAPPED = "\u00a4";

  it("leaves a genuinely open pattern open", async () => {
    await recordConversionFailures([input({ failedSequence: UNMAPPED })]);
    await recordConversionFailures([input({ failedSequence: UNMAPPED })]);
    const [[, pattern]] = patterns(db);
    expect(pattern.status).toBe("open");
  });

  it("re-opens a pattern that was marked resolved while the engine still fails", async () => {
    await recordConversionFailures([input({ failedSequence: UNMAPPED })]);
    const [[key, pattern]] = patterns(db);
    db.store.set(key, { ...pattern, status: "resolved" });

    await recordConversionFailures([input({ failedSequence: UNMAPPED })]);
    expect(db.store.get(key)?.status).toBe("open");
  });

  it("resolves a pattern the table has since grown a rule for", async () => {
    // "Av" is a live Bijoy rule, so a stored pattern for it converts now.
    await recordConversionFailures([input({ failedSequence: "Av" })]);
    const [[key]] = patterns(db);
    expect(db.store.get(key)?.status).toBe("open");

    await recordConversionFailures([input({ failedSequence: "Av" })]);
    expect(db.store.get(key)?.status).toBe("resolved");
  });

  it("never deletes the pattern or its occurrences", async () => {
    await recordConversionFailures([input({ failedSequence: "Av" })]);
    await recordConversionFailures([input({ failedSequence: "Av" })]);
    expect(patterns(db)).toHaveLength(1);
    expect(occurrences(db)).toHaveLength(2);
  });

  it("takes no status from the caller", async () => {
    // `status` is not a field of ConversionFailureInput; passing one anyway
    // must not reach the pattern.
    await recordConversionFailures([input({ failedSequence: UNMAPPED })]);
    await recordConversionFailures([
      { ...input({ failedSequence: UNMAPPED }), status: "resolved" } as ConversionFailureInput,
    ]);
    const [[, pattern]] = patterns(db);
    expect(pattern.status).toBe("open");
  });
});
