import { describe, expect, it } from "vitest";
import { createOcrEngine } from "../engine/tesseract";
import type { RecognizerWorker, WorkerFactory } from "../engine/tesseract";
import type { OcrLanguage, RawImage } from "../types";

const IMAGE: RawImage = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };

interface FakeWorker extends RecognizerWorker {
  lang: OcrLanguage;
  terminated: boolean;
  calls: number;
}

/** A factory whose workers resolve only when the test releases them, so concurrency is observable. */
function fakeFactory() {
  const workers: FakeWorker[] = [];
  let inFlight = 0;
  let peak = 0;
  const gates: Array<() => void> = [];
  const state = { failNext: false, failRecognize: false, hold: false };

  const factory: WorkerFactory = async (lang) => {
    if (state.failNext) {
      state.failNext = false;
      throw new Error("wasm failed to load");
    }
    const worker: FakeWorker = {
      lang,
      terminated: false,
      calls: 0,
      async recognize() {
        worker.calls++;
        inFlight++;
        peak = Math.max(peak, inFlight);
        try {
          if (state.hold) await new Promise<void>((resolve) => gates.push(resolve));
          if (state.failRecognize) throw new Error("worker crashed");
          return { text: `read by ${lang}`, confidence: 90, words: [{ text: "read", confidence: 90 }] };
        } finally {
          inFlight--;
        }
      },
      async terminate() {
        worker.terminated = true;
      },
    };
    workers.push(worker);
    return worker;
  };

  return {
    factory,
    workers,
    state,
    peak: () => peak,
    releaseAll: () => gates.splice(0).forEach((open) => open()),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createOcrEngine", () => {
  it("returns the text, confidence, language and per-word confidence of a pass", async () => {
    const fake = fakeFactory();
    const engine = createOcrEngine(fake.factory);
    const result = await engine.recognize(IMAGE, "ben");
    expect(result.ok && result.value).toEqual({
      text: "read by ben",
      confidence: 90,
      lang: "ben",
      words: [{ text: "read", confidence: 90 }],
    });
  });

  it("starts a worker only when one is needed, and reuses it", async () => {
    const fake = fakeFactory();
    const engine = createOcrEngine(fake.factory);
    await engine.recognize(IMAGE, "ben");
    await engine.recognize(IMAGE, "ben");
    expect(fake.workers).toHaveLength(1);
    expect(fake.workers[0].calls).toBe(2);
  });

  it("never runs more passes at once than the pool size", async () => {
    const fake = fakeFactory();
    fake.state.hold = true;
    const engine = createOcrEngine(fake.factory, { poolSize: 2 });
    const all = Promise.all([1, 2, 3, 4, 5].map(() => engine.recognize(IMAGE, "ben")));
    await tick();
    fake.releaseAll();
    await tick();
    fake.releaseAll();
    await tick();
    fake.releaseAll();
    const results = await all;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fake.peak()).toBe(2);
    expect(fake.workers).toHaveLength(2);
  });

  it("keeps a separate pool per language", async () => {
    const fake = fakeFactory();
    const engine = createOcrEngine(fake.factory);
    await engine.recognize(IMAGE, "ben");
    await engine.recognize(IMAGE, "ben+eng");
    expect(fake.workers.map((w) => w.lang)).toEqual(["ben", "ben+eng"]);
  });

  it("reports a worker that cannot start as an error, and tries again on the next call", async () => {
    const fake = fakeFactory();
    fake.state.failNext = true;
    const engine = createOcrEngine(fake.factory);
    const first = await engine.recognize(IMAGE, "ben");
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.message).not.toMatch(/wasm/);
      expect(String(first.error.debug)).toMatch(/wasm failed to load/);
    }
    expect((await engine.recognize(IMAGE, "ben")).ok).toBe(true);
  });

  it("drops a worker whose pass failed rather than reusing a possibly dead one", async () => {
    const fake = fakeFactory();
    const engine = createOcrEngine(fake.factory);
    fake.state.failRecognize = true;
    expect((await engine.recognize(IMAGE, "ben")).ok).toBe(false);
    expect(fake.workers[0].terminated).toBe(true);
    fake.state.failRecognize = false;
    expect((await engine.recognize(IMAGE, "ben")).ok).toBe(true);
    expect(fake.workers).toHaveLength(2);
  });

  it("warmUp starts one worker so a start-up failure shows before any image is read", async () => {
    const fake = fakeFactory();
    const engine = createOcrEngine(fake.factory);
    expect((await engine.warmUp("ben")).ok).toBe(true);
    expect(fake.workers).toHaveLength(1);
    await engine.recognize(IMAGE, "ben");
    expect(fake.workers).toHaveLength(1);

    fake.state.failNext = true;
    expect((await engine.warmUp("ben+eng")).ok).toBe(false);
  });

  it("dispose terminates every worker, and a disposed engine refuses new work", async () => {
    const fake = fakeFactory();
    const engine = createOcrEngine(fake.factory);
    await engine.recognize(IMAGE, "ben");
    await engine.recognize(IMAGE, "ben+eng");
    await engine.dispose();
    expect(fake.workers.every((w) => w.terminated)).toBe(true);
    expect((await engine.recognize(IMAGE, "ben")).ok).toBe(false);
  });

  it("terminates a worker that finishes starting after dispose", async () => {
    const fake = fakeFactory();
    let release!: () => void;
    const slow: WorkerFactory = async (lang) => {
      await new Promise<void>((resolve) => (release = resolve));
      return fake.factory(lang);
    };
    const engine = createOcrEngine(slow);
    const pending = engine.recognize(IMAGE, "ben");
    await tick();
    await engine.dispose();
    release();
    expect((await pending).ok).toBe(false);
    expect(fake.workers.every((w) => w.terminated)).toBe(true);
  });
});
