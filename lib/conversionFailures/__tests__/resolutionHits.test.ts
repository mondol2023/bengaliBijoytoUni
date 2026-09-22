/**
 * The counter's job is to lose nothing it can cheaply keep and to never
 * break the thing it is counting. Both halves are tested here: the
 * arithmetic (coalescing, threshold, drain ordering) and the failure
 * behaviour (a rejecting flush is reported, not thrown).
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FLUSH_AT_PENDING, createHitCounter, type PendingHits } from "../resolutionHits";

/** A flush that records what it was handed and resolves. */
function recordingFlush() {
  const batches: PendingHits[][] = [];
  const flush = vi.fn(async (pending: readonly PendingHits[]) => {
    batches.push([...pending]);
  });
  return { batches, flush };
}

function fixedClock(iso: string) {
  return () => new Date(iso);
}

describe("createHitCounter arithmetic", () => {
  it("coalesces repeated hits on one resolution into a single delta", () => {
    // The whole point: a thousand served results must not be a thousand
    // Firestore writes to one document.
    const { batches, flush } = recordingFlush();
    const counter = createHitCounter({ flush, now: fixedClock("2026-09-22T10:00:00.000Z") });

    for (let i = 0; i < 1000; i += 1) counter.record("res-1");
    expect(counter.pending()).toBe(1);

    return counter.flushNow().then(() => {
      expect(batches).toHaveLength(1);
      expect(batches[0]).toStrictEqual([
        { resolutionId: "res-1", hits: 1000, lastUsedAt: "2026-09-22T10:00:00.000Z" },
      ]);
    });
  });

  it("keeps distinct resolutions apart", async () => {
    const { batches, flush } = recordingFlush();
    const counter = createHitCounter({ flush, now: fixedClock("2026-09-22T10:00:00.000Z") });

    counter.record("res-1");
    counter.record("res-2");
    counter.record("res-1");
    await counter.flushNow();

    expect(batches[0]).toStrictEqual([
      { resolutionId: "res-1", hits: 2, lastUsedAt: "2026-09-22T10:00:00.000Z" },
      { resolutionId: "res-2", hits: 1, lastUsedAt: "2026-09-22T10:00:00.000Z" },
    ]);
  });

  it("carries the most recent serve time, not the first", async () => {
    const { batches, flush } = recordingFlush();
    let clock = "2026-09-22T10:00:00.000Z";
    const counter = createHitCounter({ flush, now: () => new Date(clock) });

    counter.record("res-1");
    clock = "2026-09-22T11:00:00.000Z";
    counter.record("res-1");
    await counter.flushNow();

    expect(batches[0][0].lastUsedAt).toBe("2026-09-22T11:00:00.000Z");
  });

  it("flushes on its own once enough distinct documents are pending", async () => {
    const { batches, flush } = recordingFlush();
    const counter = createHitCounter({ flush, flushAtPending: 3 });

    counter.record("a");
    counter.record("b");
    expect(flush).not.toHaveBeenCalled();
    counter.record("c");

    await counter.flushNow();
    expect(batches[0].map((entry) => entry.resolutionId)).toStrictEqual(["a", "b", "c"]);
  });

  it("does not flush an empty buffer", async () => {
    const { flush } = recordingFlush();
    const counter = createHitCounter({ flush });
    await counter.flushNow();
    expect(flush).not.toHaveBeenCalled();
  });

  it("ignores an empty resolution id", () => {
    // A legacy record has an empty lookupKey and can reach the serving
    // filter's edges; incrementing a document at "" would create one.
    const { flush } = recordingFlush();
    const counter = createHitCounter({ flush });
    counter.record("");
    expect(counter.pending()).toBe(0);
  });

  it("has a default threshold above one, or every hit is a write", () => {
    expect(DEFAULT_FLUSH_AT_PENDING).toBeGreaterThan(1);
  });
});

describe("createHitCounter under concurrency and failure", () => {
  it("counts a hit that arrives during a flush into the next batch, not neither", async () => {
    // The buffer is cleared before the await. A hit landing mid-write would
    // otherwise be dropped by a clear that happened after it.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const batches: PendingHits[][] = [];
    const counter = createHitCounter({
      flush: async (pending) => {
        batches.push([...pending]);
        await gate;
      },
    });

    counter.record("res-1");
    const first = counter.flushNow();
    // A tick, so the drain has actually started and cleared the buffer —
    // without it the record below lands before the drain runs and simply
    // joins the first batch, which is correct behaviour but not the case
    // this test is about.
    await Promise.resolve();
    counter.record("res-1");
    release?.();
    await first;
    await counter.flushNow();

    expect(batches).toHaveLength(2);
    const total = batches.flat().reduce((sum, entry) => sum + entry.hits, 0);
    expect(total, "a hit was dropped across the flush boundary").toBe(2);
  });

  it("serializes concurrent flushes rather than double-draining", async () => {
    const { batches, flush } = recordingFlush();
    const counter = createHitCounter({ flush });

    counter.record("res-1");
    await Promise.all([counter.flushNow(), counter.flushNow(), counter.flushNow()]);

    // Two of the three find an empty buffer and do nothing.
    expect(flush).toHaveBeenCalledTimes(1);
    expect(batches[0][0].hits).toBe(1);
  });

  it("reports a failing flush instead of rejecting", async () => {
    // A ranking counter must never surface an error into the response it
    // was counting.
    const onFlushError = vi.fn();
    const counter = createHitCounter({
      flush: async () => {
        throw new Error("firestore unavailable");
      },
      onFlushError,
    });

    counter.record("res-1");
    await expect(counter.flushNow()).resolves.toBeUndefined();
    expect(onFlushError).toHaveBeenCalledTimes(1);
  });

  it("keeps working after a failed flush", async () => {
    let failNext = true;
    const batches: PendingHits[][] = [];
    const counter = createHitCounter({
      flush: async (pending) => {
        if (failNext) {
          failNext = false;
          throw new Error("transient");
        }
        batches.push([...pending]);
      },
      onFlushError: () => {},
    });

    counter.record("res-1");
    await counter.flushNow();
    counter.record("res-2");
    await counter.flushNow();

    // The first batch's hits are gone — accepted, and stated in the module
    // doc. What must not happen is the counter wedging.
    expect(batches).toHaveLength(1);
    expect(batches[0][0].resolutionId).toBe("res-2");
  });
});
