import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetWriteMetricsForTests,
  countWrite,
  countWrites,
  flushWriteMetrics,
  getWriteMetricsSnapshot,
} from "../writeMetrics";

const DAY_ONE = Date.parse("2026-09-21T10:00:00.000Z");
const DAY_ONE_LATER = Date.parse("2026-09-21T23:00:00.000Z");
const DAY_TWO = Date.parse("2026-09-22T00:30:00.000Z");
const MINUTE = 60_000;

function clock(start: number) {
  let current = start;
  return { now: () => current, advance: (ms: number) => void (current += ms) };
}

describe("countWrite: counting", () => {
  beforeEach(() => __resetWriteMetricsForTests(DAY_ONE));

  it("counts a write against its collection and operation", () => {
    countWrite({ collection: "conversionFailures", operation: "create" }, { now: () => DAY_ONE, emit: vi.fn() });
    const snapshot = getWriteMetricsSnapshot();

    expect(snapshot.processTotal).toBe(1);
    expect(snapshot.days["2026-09-21"].total).toBe(1);
    expect(snapshot.days["2026-09-21"].byCollection.conversionFailures.byOperation.create).toBe(1);
  });

  it("counts several documents from one event", () => {
    countWrite(
      { collection: "conversionFailures", operation: "create", documents: 5 },
      { now: () => DAY_ONE, emit: vi.fn() },
    );
    expect(getWriteMetricsSnapshot().processTotal).toBe(5);
  });

  it("counts a batch in one call", () => {
    countWrites(
      [
        { collection: "conversionFailures", operation: "create" },
        { collection: "failurePatterns", operation: "update" },
      ],
      { now: () => DAY_ONE, emit: vi.fn() },
    );
    const day = getWriteMetricsSnapshot().days["2026-09-21"];
    expect(day.total).toBe(2);
    expect(day.byCollection.failurePatterns.byOperation.update).toBe(1);
  });

  it("separates operations on the same collection", () => {
    const options = { now: () => DAY_ONE, emit: vi.fn() };
    countWrite({ collection: "failurePatterns", operation: "create" }, options);
    countWrite({ collection: "failurePatterns", operation: "update" }, options);
    countWrite({ collection: "failurePatterns", operation: "update" }, options);

    const counts = getWriteMetricsSnapshot().days["2026-09-21"].byCollection.failurePatterns;
    expect(counts).toStrictEqual({ total: 3, byOperation: { create: 1, update: 2 } });
  });

  it("buckets by UTC day", () => {
    const emit = vi.fn();
    countWrite({ collection: "c", operation: "create" }, { now: () => DAY_ONE, emit });
    countWrite({ collection: "c", operation: "create" }, { now: () => DAY_ONE_LATER, emit });
    countWrite({ collection: "c", operation: "create" }, { now: () => DAY_TWO, emit });

    const { days } = getWriteMetricsSnapshot();
    expect(days["2026-09-21"].total).toBe(2);
    expect(days["2026-09-22"].total).toBe(1);
  });

  it("keeps at most a week of days, dropping the oldest", () => {
    const emit = vi.fn();
    for (let i = 0; i < 10; i++) {
      countWrite(
        { collection: "c", operation: "create" },
        { now: () => DAY_ONE + i * 24 * 60 * MINUTE, emit },
      );
    }
    const days = Object.keys(getWriteMetricsSnapshot().days);
    expect(days).toHaveLength(7);
    expect(days).not.toContain("2026-09-21");
    expect(days).toContain("2026-09-30");
  });

  it("ignores a zero or negative document count", () => {
    const options = { now: () => DAY_ONE, emit: vi.fn() };
    countWrite({ collection: "c", operation: "create", documents: 0 }, options);
    countWrite({ collection: "c", operation: "create", documents: -3 }, options);
    expect(getWriteMetricsSnapshot().processTotal).toBe(0);
  });
});

describe("countWrite: emitting", () => {
  beforeEach(() => __resetWriteMetricsForTests(DAY_ONE));

  it("does not emit a line for every write", () => {
    const emit = vi.fn();
    const time = clock(DAY_ONE);
    for (let i = 0; i < 100; i++) {
      countWrite({ collection: "c", operation: "create" }, { now: time.now, emit });
    }
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits one structured line once the window has passed", () => {
    const emit = vi.fn();
    const time = clock(DAY_ONE);
    countWrite({ collection: "conversionFailures", operation: "create" }, { now: time.now, emit });
    countWrite({ collection: "failurePatterns", operation: "update" }, { now: time.now, emit });

    time.advance(MINUTE + 1);
    countWrite({ collection: "conversionFailures", operation: "create" }, { now: time.now, emit });

    expect(emit).toHaveBeenCalledTimes(1);
    const line = JSON.parse(emit.mock.calls[0][0]);
    expect(line.metric).toBe("firestore_writes");
    expect(line.day).toBe("2026-09-21");
    expect(line.total).toBe(3);
    expect(line.deltas).toStrictEqual({
      "conversionFailures:create": 2,
      "failurePatterns:update": 1,
    });
    expect(line.instanceId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("emits deltas, not cumulative totals, so drained lines can be summed", () => {
    const emit = vi.fn();
    const time = clock(DAY_ONE);

    countWrite({ collection: "c", operation: "create" }, { now: time.now, emit });
    time.advance(MINUTE + 1);
    countWrite({ collection: "c", operation: "create" }, { now: time.now, emit });
    time.advance(MINUTE + 1);
    countWrite({ collection: "c", operation: "create" }, { now: time.now, emit });

    expect(emit).toHaveBeenCalledTimes(2);
    const totals = emit.mock.calls.map((call) => JSON.parse(call[0]).total);
    // The write that triggers an emit is recorded first, so it lands in the
    // line it triggered: [t0 + the write at t0+60s], then [the one after].
    expect(totals).toStrictEqual([2, 1]);
    // Summed, the lines equal the process total with nothing left pending.
    // That is the whole contract a log drain relies on.
    expect(totals.reduce((a, b) => a + b, 0)).toBe(getWriteMetricsSnapshot().processTotal);
  });

  it("emits nothing when there is nothing pending", () => {
    const emit = vi.fn();
    flushWriteMetrics({ now: () => DAY_ONE + 10 * MINUTE, emit });
    expect(emit).not.toHaveBeenCalled();
  });

  it("flushes on demand without waiting for the window", () => {
    const emit = vi.fn();
    countWrite({ collection: "c", operation: "create" }, { now: () => DAY_ONE, emit });
    expect(emit).not.toHaveBeenCalled();

    flushWriteMetrics({ now: () => DAY_ONE, emit });
    expect(emit).toHaveBeenCalledTimes(1);
    // And the flushed counts are not emitted twice.
    flushWriteMetrics({ now: () => DAY_ONE, emit });
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("countWrite: never breaks its caller", () => {
  beforeEach(() => __resetWriteMetricsForTests(DAY_ONE));

  it("swallows a throwing sink", () => {
    expect(() =>
      countWrite(
        { collection: "c", operation: "create" },
        {
          now: () => DAY_ONE + 10 * MINUTE,
          emit: () => {
            throw new Error("stdout is gone");
          },
        },
      ),
    ).not.toThrow();
  });

  it("swallows a throwing clock", () => {
    expect(() =>
      countWrite(
        { collection: "c", operation: "create" },
        {
          now: () => {
            throw new Error("no clock");
          },
          emit: vi.fn(),
        },
      ),
    ).not.toThrow();
  });
});

describe("the instrumentation does not write to Firestore", () => {
  it("imports nothing that could", async () => {
    // The module must stay dependency-free: the moment it can reach the
    // Admin SDK, someone will persist the counters and the instrument will
    // start moving the number it measures.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.resolve(__dirname, "..", "writeMetrics.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain("firebase-admin");
    expect(source).not.toContain("getAdminDb");
  });
});
