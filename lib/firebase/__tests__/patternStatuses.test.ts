/**
 * The batched status read behind the snapshot's publication rule. One
 * `getAll` for the lot, no read for nothing, and an absent or unparseable
 * pattern is absent from the answer — which the caller reads as "do not
 * publish".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({ FieldValue: {} }));
vi.mock("../admin", () => ({ getAdminDb: vi.fn() }));

import { getAdminDb } from "../admin";
import { getFailurePatternStatuses } from "../conversionFailures";

function pattern(status: "open" | "resolved") {
  return {
    encodingId: "bijoy",
    engineVersion: "1.0.0",
    failedSequence: "Av",
    failureCategory: "unmapped_character",
    occurrenceCount: 3,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    sampleOccurrenceIds: [],
    status,
  };
}

function mockDb(store: Record<string, unknown>) {
  const getAll = vi.fn(async (...refs: { id: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: ref.id in store,
      data: () => store[ref.id],
    })),
  );
  const db = {
    getAll,
    collection: (name: string) => ({
      doc: (id: string) => {
        expect(name).toBe("failurePatterns");
        return { id };
      },
    }),
  };
  vi.mocked(getAdminDb).mockReturnValue(db as never);
  return getAll;
}

describe("getFailurePatternStatuses", () => {
  beforeEach(() => {
    vi.mocked(getAdminDb).mockReset();
  });

  it("reads every named pattern in one batched call, de-duplicated", async () => {
    const getAll = mockDb({ a: pattern("open"), b: pattern("resolved") });
    const statuses = await getFailurePatternStatuses(["a", "b", "a"]);
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getAll.mock.calls[0]).toHaveLength(2);
    expect(statuses).toStrictEqual(
      new Map([
        ["a", "open"],
        ["b", "resolved"],
      ]),
    );
  });

  it("leaves out a missing or malformed pattern rather than guessing its status", async () => {
    mockDb({ a: pattern("open"), broken: { status: "open" } });
    const statuses = await getFailurePatternStatuses(["a", "gone", "broken"]);
    expect([...statuses.keys()]).toStrictEqual(["a"]);
  });

  it("makes no read for an empty list or empty ids", async () => {
    const getAll = mockDb({});
    expect((await getFailurePatternStatuses([])).size).toBe(0);
    expect((await getFailurePatternStatuses(["", ""])).size).toBe(0);
    expect(getAll).not.toHaveBeenCalled();
  });
});
