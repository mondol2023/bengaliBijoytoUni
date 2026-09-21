import { describe, expect, it, vi } from "vitest";
import { CONVERSION_FAILURE_LIMITS } from "../limits";
import { createReportBuffer, type BufferedReport } from "../reportBuffer";
import type { BuiltFailureOccurrence } from "../occurrence";

function occurrence(sequence: string, contextBefore = ""): BuiltFailureOccurrence {
  return {
    source: "text",
    encodingId: "bijoy",
    engineVersion: "1.0.0",
    rulesHash: "aaaa1111",
    failureCategory: "unmapped_character",
    failedSequence: sequence,
    position: 0,
    contextBefore,
    contextAfter: "",
    engineOutput: null,
    errorCode: "UNMAPPED_CHARACTER",
    errorReason: "no rule",
    severity: "warning",
    fileName: null,
    fileType: null,
  };
}

function collector() {
  const batches: BufferedReport[][] = [];
  return { batches, flush: vi.fn((items: BufferedReport[]) => void batches.push(items)) };
}

describe("createReportBuffer: counting", () => {
  it("buffers the full count of a first sighting", () => {
    const { flush } = collector();
    const buffer = createReportBuffer({ flush });
    expect(buffer.record("k", occurrence("Av"), 47)).toBe(47);
    expect(buffer.pendingCount()).toBe(1);
  });

  it("sends the count, not one per occurrence", async () => {
    const { batches, flush } = collector();
    const buffer = createReportBuffer({ flush });
    buffer.record("k", occurrence("Av"), 47);
    await buffer.flushNow();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0][0].occurrenceCount).toBe(47);
  });

  it("reports only the increase when a later conversion sees more", async () => {
    const { batches, flush } = collector();
    const buffer = createReportBuffer({ flush });

    expect(buffer.record("k", occurrence("Av"), 10)).toBe(10);
    await buffer.flushNow();
    expect(buffer.record("k", occurrence("Av"), 14)).toBe(4);
    await buffer.flushNow();

    expect(batches.map((batch) => batch[0].occurrenceCount)).toStrictEqual([10, 4]);
  });

  it("reports nothing when a later conversion sees the same or fewer", () => {
    const { flush } = collector();
    const buffer = createReportBuffer({ flush });

    buffer.record("k", occurrence("Av"), 10);
    // The user keeps typing elsewhere: the same sequence, the same count,
    // re-observed on every debounced conversion. None of that is new.
    expect(buffer.record("k", occurrence("Av"), 10)).toBe(0);
    // And deleting text must never produce a negative or a re-report.
    expect(buffer.record("k", occurrence("Av"), 3)).toBe(0);
  });

  it("accumulates several increases into one pending entry", async () => {
    const { batches, flush } = collector();
    const buffer = createReportBuffer({ flush });

    buffer.record("k", occurrence("Av"), 5);
    buffer.record("k", occurrence("Av"), 8);
    buffer.record("k", occurrence("Av"), 12);
    expect(buffer.pendingCount()).toBe(1);
    await buffer.flushNow();

    expect(batches[0][0].occurrenceCount).toBe(12);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct patterns distinct", async () => {
    const { batches, flush } = collector();
    const buffer = createReportBuffer({ flush });
    buffer.record("a", occurrence("Av"), 3);
    buffer.record("b", occurrence("Kv"), 7);
    await buffer.flushNow();

    expect(batches[0]).toHaveLength(2);
    expect(batches[0].map((item) => item.occurrenceCount).sort()).toStrictEqual([3, 7]);
  });

  it("ignores a zero or negative observation", () => {
    const { flush } = collector();
    const buffer = createReportBuffer({ flush });
    expect(buffer.record("k", occurrence("Av"), 0)).toBe(0);
    expect(buffer.record("k", occurrence("Av"), -5)).toBe(0);
    expect(buffer.pendingCount()).toBe(0);
  });

  it("keeps the newest context window for a pattern", async () => {
    const { batches, flush } = collector();
    const buffer = createReportBuffer({ flush });
    buffer.record("k", occurrence("Av", "old context"), 1);
    buffer.record("k", occurrence("Av", "new context"), 2);
    await buffer.flushNow();

    expect(batches[0][0].occurrence.contextBefore).toBe("new context");
  });

  it("clamps a single entry to the server's ceiling", async () => {
    const { batches, flush } = collector();
    const buffer = createReportBuffer({ flush });
    buffer.record("k", occurrence("Av"), CONVERSION_FAILURE_LIMITS.maxOccurrenceCount + 5_000);
    await buffer.flushNow();

    expect(batches[0][0].occurrenceCount).toBe(CONVERSION_FAILURE_LIMITS.maxOccurrenceCount);
  });
});

describe("createReportBuffer: flushing", () => {
  it("does not call flush when there is nothing pending", async () => {
    const { flush } = collector();
    const buffer = createReportBuffer({ flush });
    await buffer.flushNow();
    expect(flush).not.toHaveBeenCalled();
  });

  it("empties the buffer when it flushes", async () => {
    const { flush } = collector();
    const buffer = createReportBuffer({ flush });
    buffer.record("k", occurrence("Av"), 1);
    await buffer.flushNow();
    expect(buffer.pendingCount()).toBe(0);
    await buffer.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushes by itself once maxItems distinct patterns are pending", () => {
    const { flush } = collector();
    const buffer = createReportBuffer({ flush, maxItems: 3 });
    buffer.record("a", occurrence("a"), 1);
    buffer.record("b", occurrence("b"), 1);
    expect(flush).not.toHaveBeenCalled();
    buffer.record("c", occurrence("c"), 1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(buffer.pendingCount()).toBe(0);
  });

  it("defaults maxItems to what one request accepts", () => {
    const { flush } = collector();
    const buffer = createReportBuffer({ flush });
    for (let i = 0; i < CONVERSION_FAILURE_LIMITS.maxFailuresPerReport; i++) {
      buffer.record(`k${i}`, occurrence(`s${i}`), 1);
    }
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0]).toHaveLength(CONVERSION_FAILURE_LIMITS.maxFailuresPerReport);
  });

  it("swallows a rejected flush", async () => {
    const buffer = createReportBuffer({ flush: () => Promise.reject(new Error("offline")) });
    buffer.record("k", occurrence("Av"), 1);
    await expect(buffer.flushNow()).resolves.toBeUndefined();
  });

  it("swallows a flush that throws synchronously", async () => {
    const buffer = createReportBuffer({
      flush: () => {
        throw new Error("boom");
      },
    });
    buffer.record("k", occurrence("Av"), 1);
    await expect(buffer.flushNow()).resolves.toBeUndefined();
  });

  it("does not re-send a failed batch, because a retry would double-count", async () => {
    const flush = vi.fn().mockRejectedValue(new Error("offline"));
    const buffer = createReportBuffer({ flush });
    buffer.record("k", occurrence("Av"), 5);
    await buffer.flushNow();
    await buffer.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("createReportBuffer: reset", () => {
  it("forgets pending deltas and the high-water marks", async () => {
    const { batches, flush } = collector();
    const buffer = createReportBuffer({ flush });
    buffer.record("k", occurrence("Av"), 10);
    buffer.reset();
    expect(buffer.pendingCount()).toBe(0);

    // A fresh session sees the same ten occurrences as new.
    expect(buffer.record("k", occurrence("Av"), 10)).toBe(10);
    await buffer.flushNow();
    expect(batches[0][0].occurrenceCount).toBe(10);
  });
});
