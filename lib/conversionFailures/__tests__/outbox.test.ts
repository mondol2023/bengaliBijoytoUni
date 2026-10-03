import { describe, expect, it, vi } from "vitest";
import { createFailureOutbox, type OutboxBatch, type SendOutcome, type StorageLike } from "../outbox";

type Failure = { failedSequence: string };

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const anonymous = { kind: "anonymous", visitorId: "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b" } as const;

function setup(outcomes: SendOutcome[] | ((batch: OutboxBatch<Failure>) => Promise<SendOutcome>), storage: StorageLike | null = memoryStorage()) {
  const sent: OutboxBatch<Failure>[] = [];
  let id = 0;
  let clock = 1_000;
  const send = vi.fn(async (batch: OutboxBatch<Failure>) => {
    sent.push(batch);
    if (typeof outcomes === "function") return outcomes(batch);
    return outcomes.shift() ?? "delivered";
  });
  const outbox = createFailureOutbox<Failure>({
    storage,
    send,
    newId: () => `batch-${++id}`,
    now: () => clock,
  });
  return { outbox, send, sent, storage, advance: (ms: number) => (clock += ms) };
}

describe("failure outbox", () => {
  it("holds an enqueued batch in storage until it is drained", async () => {
    const { outbox, send, storage } = setup([]);
    outbox.enqueue([{ failedSequence: "Av" }], anonymous);

    expect(send).not.toHaveBeenCalled();
    expect(outbox.pending()).toHaveLength(1);
    expect(storage?.getItem("convert2uni.failureOutbox")).toContain("Av");
  });

  it("removes a batch once it is delivered", async () => {
    const { outbox, sent } = setup(["delivered"]);
    outbox.enqueue([{ failedSequence: "Av" }], anonymous);
    await outbox.drain();

    expect(sent.map((b) => b.failures[0].failedSequence)).toEqual(["Av"]);
    expect(sent[0].auth).toEqual(anonymous);
    expect(outbox.pending()).toEqual([]);
  });

  it("keeps a batch whose send failed, and stops draining", async () => {
    const { outbox, send } = setup(["retry"]);
    outbox.enqueue([{ failedSequence: "one" }], anonymous);
    outbox.enqueue([{ failedSequence: "two" }], anonymous);
    await outbox.drain();

    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.pending().map((b) => b.failures[0].failedSequence)).toEqual(["one", "two"]);
  });

  it("treats a thrown send as a retry, not a loss", async () => {
    const { outbox } = setup(async () => {
      throw new Error("offline");
    });
    outbox.enqueue([{ failedSequence: "Av" }], anonymous);
    await outbox.drain();
    expect(outbox.pending()).toHaveLength(1);
  });

  it("drops a batch the server rejected, since resending cannot succeed", async () => {
    const { outbox } = setup(["rejected", "delivered"]);
    outbox.enqueue([{ failedSequence: "bad" }], anonymous);
    outbox.enqueue([{ failedSequence: "good" }], anonymous);
    await outbox.drain();
    expect(outbox.pending()).toEqual([]);
  });

  it("takes a batch out of storage before sending it, so a page killed mid-send never resends it", async () => {
    let seenDuringSend: number | null = null;
    const storage = memoryStorage();
    const { outbox } = setup(async () => {
      seenDuringSend = outbox.pending().length;
      return "delivered";
    }, storage);
    outbox.enqueue([{ failedSequence: "Av" }], anonymous);
    await outbox.drain();
    expect(seenDuringSend).toBe(0);
  });

  it("delivers what a previous visit left behind", async () => {
    const storage = memoryStorage();
    setup([], storage).outbox.enqueue([{ failedSequence: "left over" }], anonymous);

    const next = setup(["delivered"], storage);
    await next.outbox.drain();
    expect(next.sent.map((b) => b.failures[0].failedSequence)).toEqual(["left over"]);
  });

  it("does not lose a batch another tab enqueued while this one was sending", async () => {
    const storage = memoryStorage();
    const other = setup([], storage).outbox;
    const { outbox } = setup(async () => {
      other.enqueue([{ failedSequence: "from other tab" }], anonymous);
      return "delivered";
    }, storage);
    outbox.enqueue([{ failedSequence: "mine" }], anonymous);
    await outbox.drain();
    // The other tab's batch is still waiting (it arrived after this drain's snapshot).
    expect(outbox.pending().map((b) => b.failures[0].failedSequence)).toEqual(["from other tab"]);
  });

  it("discards batches older than the age limit instead of sending stale reports", async () => {
    const { outbox, send, advance } = setup([]);
    outbox.enqueue([{ failedSequence: "old" }], anonymous);
    advance(8 * 24 * 60 * 60 * 1000);
    await outbox.drain();
    expect(send).not.toHaveBeenCalled();
    expect(outbox.pending()).toEqual([]);
  });

  it("caps the queue by dropping the oldest batches", () => {
    const { outbox } = setup([]);
    for (let i = 0; i < 25; i++) outbox.enqueue([{ failedSequence: `s${i}` }], anonymous);
    const pending = outbox.pending();
    expect(pending).toHaveLength(20);
    expect(pending[0].failures[0].failedSequence).toBe("s5");
  });

  it("ignores an empty batch", () => {
    const { outbox } = setup([]);
    outbox.enqueue([], anonymous);
    expect(outbox.pending()).toEqual([]);
  });

  it("reads corrupt storage as an empty queue", async () => {
    const storage = memoryStorage();
    storage.setItem("convert2uni.failureOutbox", "{not json");
    const { outbox, send } = setup([], storage);
    expect(outbox.pending()).toEqual([]);
    outbox.enqueue([{ failedSequence: "Av" }], anonymous);
    await outbox.drain();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps working in memory when storage throws", async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const { outbox, sent } = setup(["delivered"], throwing);
    outbox.enqueue([{ failedSequence: "Av" }], anonymous);
    expect(outbox.pending()).toHaveLength(1);
    await outbox.drain();
    expect(sent).toHaveLength(1);
    expect(outbox.pending()).toEqual([]);
  });

  it("works with no storage at all", async () => {
    const { outbox, sent } = setup(["delivered"], null);
    outbox.enqueue([{ failedSequence: "Av" }], anonymous);
    await outbox.drain();
    expect(sent).toHaveLength(1);
  });

  it("does not run two drains at once in the same tab", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { outbox, send } = setup(async () => {
      await gate;
      return "delivered";
    });
    outbox.enqueue([{ failedSequence: "Av" }], anonymous);
    const first = outbox.drain();
    const second = outbox.drain();
    release();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
