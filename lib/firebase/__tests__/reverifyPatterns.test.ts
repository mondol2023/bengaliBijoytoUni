/**
 * The sweep's apply step. The judgement is tested in
 * `lib/conversionFailures/__tests__/reverify.test.ts`; what matters here is
 * that applying it writes only `status`, writes nothing when nothing
 * changed, and never deletes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WithId } from "../conversionFailures";
import type { FailurePattern } from "../schemas";

vi.mock("../admin", () => ({ getAdminDb: vi.fn() }));
vi.mock("../conversionFailures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../conversionFailures")>();
  return { ...actual, listFailurePatterns: vi.fn() };
});

import { getAdminDb } from "../admin";
import { listFailurePatterns } from "../conversionFailures";
import { reverifyStoredPatterns, REVERIFY_SWEEP_LIMIT } from "../reverifyPatterns";

/** Every case here expects the sweep to run; the refusal has its own case. */
async function sweep(options?: Parameters<typeof reverifyStoredPatterns>[0]) {
  const result = await reverifyStoredPatterns(options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

/** "Av" is a live Bijoy rule; U+00A4 matches nothing in that table. */
const CONVERTS = "Av";
const STILL_FAILS = "¤";

interface Update {
  readonly path: string;
  readonly patch: Record<string, unknown>;
}

function createMockDb() {
  const updates: Update[] = [];
  const deletes: string[] = [];
  let commits = 0;

  const db = {
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
    batch: () => ({
      update: (ref: { path: string }, patch: Record<string, unknown>) => {
        updates.push({ path: ref.path, patch });
      },
      delete: (ref: { path: string }) => {
        deletes.push(ref.path);
      },
      async commit() {
        commits += 1;
      },
    }),
  };

  return { db, updates, deletes, commits: () => commits };
}

function pattern(overrides: Partial<WithId<FailurePattern>> = {}): WithId<FailurePattern> {
  return {
    id: "pattern-1",
    encodingId: "bijoy",
    engineVersion: "old",
    failedSequence: STILL_FAILS,
    failureCategory: "unmapped_character",
    occurrenceCount: 1,
    firstSeenAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
    sampleOccurrenceIds: [],
    status: "open",
    ...overrides,
  };
}

let mock: ReturnType<typeof createMockDb>;

beforeEach(() => {
  vi.clearAllMocks();
  mock = createMockDb();
  vi.mocked(getAdminDb).mockReturnValue(mock.db as unknown as ReturnType<typeof getAdminDb>);
});

describe("reverifyStoredPatterns", () => {
  it("writes nothing when every stored status already agrees with the engine", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([pattern()]);
    const report = await sweep();
    expect(report).toStrictEqual({ examined: 1, resolved: [], reopened: [] });
    expect(mock.updates).toStrictEqual([]);
    expect(mock.commits()).toBe(0);
  });

  it("resolves a pattern the table has since grown a rule for", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([
      pattern({ id: "a", failedSequence: CONVERTS }),
    ]);
    const report = await sweep();
    expect(report.resolved).toStrictEqual(["a"]);
    expect(mock.updates).toStrictEqual([
      { path: "failurePatterns/a", patch: { status: "resolved" } },
    ]);
  });

  it("re-opens a pattern marked resolved that the engine still fails on", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([pattern({ id: "c", status: "resolved" })]);
    const report = await sweep();
    expect(report.reopened).toStrictEqual(["c"]);
    expect(mock.updates).toStrictEqual([{ path: "failurePatterns/c", patch: { status: "open" } }]);
  });

  it("writes only status, never a count, an expiry or anything else", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([
      pattern({ id: "a", failedSequence: CONVERTS }),
      pattern({ id: "c", status: "resolved" }),
    ]);
    await sweep();
    for (const update of mock.updates) {
      expect(Object.keys(update.patch)).toStrictEqual(["status"]);
    }
  });

  it("never deletes", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([
      pattern({ id: "a", failedSequence: CONVERTS }),
      pattern({ id: "c", status: "resolved" }),
    ]);
    await sweep();
    expect(mock.deletes).toStrictEqual([]);
  });

  it("commits one batch for the whole window", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([
      pattern({ id: "a", failedSequence: CONVERTS }),
      pattern({ id: "c", status: "resolved" }),
    ]);
    await sweep();
    expect(mock.commits()).toBe(1);
  });

  it("caps the window rather than trusting the caller", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([]);
    await sweep({ limit: 100_000 });
    expect(listFailurePatterns).toHaveBeenCalledWith({
      encodingId: undefined,
      limit: REVERIFY_SWEEP_LIMIT,
    });
  });

  it("sweeps one encoding when asked", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([]);
    await sweep({ encodingId: "bijoy", limit: 10 });
    expect(listFailurePatterns).toHaveBeenCalledWith({ encodingId: "bijoy", limit: 10 });
  });

  it("refuses an unknown encoding instead of sweeping everything", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([]);
    const result = await reverifyStoredPatterns({ encodingId: "not-an-encoding" });
    expect(result.ok).toBe(false);
    expect(listFailurePatterns).not.toHaveBeenCalled();
  });

  it("fails closed on a pattern with no encoding, leaving it open", async () => {
    vi.mocked(listFailurePatterns).mockResolvedValue([
      pattern({ id: "n", encodingId: null, failedSequence: CONVERTS, status: "resolved" }),
    ]);
    const report = await sweep();
    expect(report.reopened).toStrictEqual(["n"]);
  });
});
