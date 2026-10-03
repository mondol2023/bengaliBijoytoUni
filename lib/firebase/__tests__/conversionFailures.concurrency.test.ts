/**
 * The atomic upsert under concurrent writes: many reports of the same new
 * pattern, arriving at once, must produce exactly one pattern document whose
 * `occurrenceCount` is the sum of what every committed report carried.
 *
 * ## What this runs against, and what it does not
 *
 * Not the Firestore emulator — there is no JDK on the machine this was
 * written on, so an emulator run remains UNVERIFIED. What it runs against is
 * a fake that models the one property the upsert relies on: a transaction
 * that read a document someone else has since committed does not commit; it
 * is thrown away and the body re-run against the newer state, up to
 * `DEFAULT_MAX_TRANSACTION_ATTEMPTS` (5) times, then it fails.
 *
 * The real Admin SDK gets there differently — it takes pessimistic locks on
 * what a transaction reads and retries on `ABORTED` — but the guarantee a
 * caller sees is the same: committed transactions are serializable. That
 * guarantee is what is modelled here. Lock waits, deadlock detection and
 * timing are not.
 *
 * The suite in `conversionFailures.test.ts` cannot show any of this: its
 * fake runs the body once, applying writes as it goes, so two transactions
 * never overlap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
  },
}));

vi.mock("../admin", () => ({ getAdminDb: vi.fn() }));

import { getAdminDb } from "../admin";
import { recordConversionFailures, type ConversionFailureInput } from "../conversionFailures";

/** Matches `DEFAULT_MAX_TRANSACTION_ATTEMPTS` in `@google-cloud/firestore`. */
const FIRESTORE_MAX_ATTEMPTS = 5;

type Data = Record<string, unknown>;

interface Increment {
  __increment: number;
}

function isIncrement(value: unknown): value is Increment {
  return typeof value === "object" && value !== null && "__increment" in value;
}

/** Yields to the event loop, so every concurrent transaction gets to read before any commits. */
function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface ContendedDbOptions {
  maxAttempts?: number;
  /**
   * Off only for the control test: commits without checking what was read,
   * which is what the upsert would face without a transaction at all.
   */
  validateReads?: boolean;
}

function createContendedDb({ maxAttempts = FIRESTORE_MAX_ATTEMPTS, validateReads = true }: ContendedDbOptions = {}) {
  const store = new Map<string, Data>();
  /** Bumped on every committed write; a document never written is version 0. */
  const versions = new Map<string, number>();
  let autoId = 0;
  const stats = { commits: 0, aborts: 0, exhausted: 0 };

  function makeDocRef(collectionName: string, docId?: string) {
    const id = docId ?? `auto-${++autoId}`;
    return { id, path: `${collectionName}/${id}` };
  }

  type Ref = ReturnType<typeof makeDocRef>;
  type Write = { kind: "set"; ref: Ref; data: Data } | { kind: "update"; ref: Ref; patch: Data };

  function apply(write: Write) {
    if (write.kind === "set") {
      store.set(write.ref.path, { ...write.data });
    } else {
      // Firestore rejects an update to a missing document; so does this.
      const existing = store.get(write.ref.path);
      if (existing === undefined) throw new Error(`NOT_FOUND: ${write.ref.path}`);
      const next = { ...existing };
      for (const [field, value] of Object.entries(write.patch)) {
        // Increments resolve against the committed value at commit time, as
        // they do server-side.
        next[field] = isIncrement(value) ? ((existing[field] as number | undefined) ?? 0) + value.__increment : value;
      }
      store.set(write.ref.path, next);
    }
    versions.set(write.ref.path, (versions.get(write.ref.path) ?? 0) + 1);
  }

  return {
    store,
    stats,
    collection(name: string) {
      return { doc: (docId?: string) => makeDocRef(name, docId) };
    },
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const readVersions = new Map<string, number>();
        const writes: Write[] = [];
        const tx = {
          async get(ref: Ref) {
            // Snapshot taken now, then the turn is handed over: the window in
            // which another writer can commit underneath this one.
            const data = store.get(ref.path);
            readVersions.set(ref.path, versions.get(ref.path) ?? 0);
            await yieldTurn();
            return { exists: data !== undefined, id: ref.id, data: () => data };
          },
          set(ref: Ref, data: Data) {
            writes.push({ kind: "set", ref, data });
          },
          update(ref: Ref, patch: Data) {
            writes.push({ kind: "update", ref, patch });
          },
        };

        const result = await fn(tx);

        // Commit is synchronous from here on, so it is atomic with respect
        // to every other transaction in this single-threaded model.
        const stale =
          validateReads &&
          [...readVersions].some(([path, version]) => (versions.get(path) ?? 0) !== version);
        if (stale) {
          stats.aborts++;
          continue;
        }
        writes.forEach(apply);
        stats.commits++;
        return result;
      }
      stats.exhausted++;
      throw new Error(`ABORTED: transaction contended on all ${maxAttempts} attempts`);
    },
  };
}

type ContendedDb = ReturnType<typeof createContendedDb>;

function input(overrides: Partial<ConversionFailureInput> = {}): ConversionFailureInput {
  return {
    userId: null,
    sessionId: "session-1",
    source: "text",
    encodingId: "bijoy",
    engineVersion: "1.0.0",
    rulesHash: "aaaa1111",
    failureCategory: "unmapped_character",
    // No Bijoy rule matches this, so the pattern stays `open` throughout.
    failedSequence: "¤",
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

function entries(db: ContendedDb, collection: string) {
  return [...db.store.entries()].filter(([key]) => key.startsWith(`${collection}/`));
}

/**
 * One request per report, all in flight at once — what N serverless
 * instances receiving the same failure at the same moment look like to
 * Firestore. Separate calls rather than one batch, and settled rather than
 * `Promise.all`, so one exhausted transaction does not hide the others.
 */
function reportConcurrently(counts: number[]) {
  return Promise.allSettled(counts.map((occurrenceCount) => recordConversionFailures([input({ occurrenceCount })])));
}

describe("recordConversionFailures: atomic upsert under concurrent writes", () => {
  let db: ContendedDb;

  beforeEach(() => {
    db = createContendedDb();
    vi.mocked(getAdminDb).mockReturnValue(db as unknown as ReturnType<typeof getAdminDb>);
  });

  it("creates one pattern whose count is the sum of every concurrent report", async () => {
    // Five concurrent first reports, within Firestore's five-attempt budget.
    const counts = [3, 7, 11, 1, 25];
    const results = await reportConcurrently(counts);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const patterns = entries(db, "failurePatterns");
    expect(patterns).toHaveLength(1);
    expect(patterns[0][1].occurrenceCount).toBe(47);
    expect(entries(db, "conversionFailures")).toHaveLength(5);
    // The model actually contended: every report read "no pattern yet"
    // before any of them committed.
    expect(db.stats.aborts).toBeGreaterThan(0);
  });

  it("increments an existing pattern by every concurrent report, losing none", async () => {
    await recordConversionFailures([input({ occurrenceCount: 100 })]);
    const results = await reportConcurrently([1, 2, 3, 4]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const patterns = entries(db, "failurePatterns");
    expect(patterns).toHaveLength(1);
    expect(patterns[0][1].occurrenceCount).toBe(110);
  });

  it("keeps sample occurrence IDs pointing at occurrences that were actually committed", async () => {
    await reportConcurrently([1, 1, 1, 1, 1]);

    const [[, pattern]] = entries(db, "failurePatterns");
    const committed = new Set(entries(db, "conversionFailures").map(([key]) => key.split("/")[1]));
    const samples = pattern.sampleOccurrenceIds as string[];
    // An aborted attempt's occurrence ID must not leak into the aggregate.
    expect(samples).toHaveLength(5);
    expect(samples.every((id) => committed.has(id))).toBe(true);
  });

  it("never lets the aggregate drift from the occurrences that committed, even past the retry budget", async () => {
    // Twelve at once is more contention than five attempts can absorb when
    // every report hits the same document, so some fail — as they would on
    // Firestore. What must hold is that a failed report wrote nothing: no
    // occurrence without its increment, no increment without its occurrence.
    const counts = Array.from({ length: 12 }, (_, i) => i + 1);
    const results = await reportConcurrently(counts);

    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    expect(db.stats.exhausted).toBe(rejected.length);

    const occurrences = entries(db, "conversionFailures");
    expect(occurrences).toHaveLength(12 - rejected.length);
    const committedSum = occurrences.reduce((sum, [, doc]) => sum + (doc.occurrenceCount as number), 0);

    const patterns = entries(db, "failurePatterns");
    expect(patterns).toHaveLength(1);
    expect(patterns[0][1].occurrenceCount).toBe(committedSum);
  });

  it("keeps distinct sequences reported concurrently in distinct patterns", async () => {
    await Promise.all([
      recordConversionFailures([input({ failedSequence: "¤", occurrenceCount: 2 })]),
      recordConversionFailures([input({ failedSequence: "¥", occurrenceCount: 5 })]),
      recordConversionFailures([input({ failedSequence: "¤", occurrenceCount: 3 })]),
      recordConversionFailures([input({ failedSequence: "¥", occurrenceCount: 7 })]),
    ]);

    const counts = entries(db, "failurePatterns")
      .map(([, doc]) => doc.occurrenceCount as number)
      .sort((a, b) => a - b);
    expect(counts).toStrictEqual([5, 12]);
  });

});

/**
 * Control: the same contention against a store that commits without
 * checking what the transaction read. If this did not lose counts, the
 * interleaving above would not be exercising anything, and the tests passing
 * would say nothing about the transaction.
 */
describe("control: the same contention without read validation", () => {
  it("loses reports, which is what the transaction exists to prevent", async () => {
    const db = createContendedDb({ validateReads: false });
    vi.mocked(getAdminDb).mockReturnValue(db as unknown as ReturnType<typeof getAdminDb>);

    await reportConcurrently([3, 7, 11, 1, 25]);

    // Every report saw "no pattern" and each `set` overwrote the last, so
    // the pattern holds one report's count instead of 47.
    const [[, pattern]] = entries(db, "failurePatterns");
    expect(pattern.occurrenceCount).not.toBe(47);
    expect(entries(db, "conversionFailures")).toHaveLength(5);
  });
});
