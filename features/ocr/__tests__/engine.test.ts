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
    await tick();
    expect(fake.workers.every((w) => w.terminated)).toBe(true);
  });
});

/**
 * tesseract.js never rejects a job whose worker was terminated or crashed — the promise
 * simply never settles. These fakes do the same, so the engine must not wait on them.
 */
describe("createOcrEngine hardening", () => {
  function hangingFactory() {
    const workers: FakeWorker[] = [];
    const factory: WorkerFactory = async (lang) => {
      const worker: FakeWorker = {
        lang,
        terminated: false,
        calls: 0,
        recognize() {
          worker.calls++;
          return new Promise(() => undefined);
        },
        async terminate() {
          worker.terminated = true;
        },
      };
      workers.push(worker);
      return worker;
    };
    return { factory, workers };
  }

  it("settles a pass that is in flight when the engine is disposed", async () => {
    const fake = hangingFactory();
    const engine = createOcrEngine(fake.factory, { recognizeTimeoutMs: 60_000 });
    const pending = engine.recognize(IMAGE, "ben");
    await tick();
    await engine.dispose();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/stopped/i);
    expect(fake.workers[0].terminated).toBe(true);
  });

  it("gives up on a pass that never answers, and replaces its worker", async () => {
    const fake = hangingFactory();
    const engine = createOcrEngine(fake.factory, { recognizeTimeoutMs: 20 });
    const result = await engine.recognize(IMAGE, "ben");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/took too long/i);
      expect(String(result.error.debug)).toMatch(/timed out/);
    }
    expect(fake.workers[0].terminated).toBe(true);
    await engine.recognize(IMAGE, "ben");
    expect(fake.workers).toHaveLength(2);
  });

  it("gives up on a worker that never finishes starting, and terminates it if it turns up later", async () => {
    const fake = fakeFactory();
    let release!: () => void;
    let calls = 0;
    const slow: WorkerFactory = async (lang) => {
      calls++;
      if (calls === 1) await new Promise<void>((resolve) => (release = resolve));
      return fake.factory(lang);
    };
    const engine = createOcrEngine(slow, { startTimeoutMs: 20 });
    const first = await engine.warmUp("ben");
    expect(first.ok).toBe(false);
    if (!first.ok) expect(String(first.error.debug)).toMatch(/timed out/);

    // The slot it held is free again.
    expect((await engine.recognize(IMAGE, "ben")).ok).toBe(true);

    release();
    await tick();
    expect(fake.workers).toHaveLength(2);
    expect(fake.workers[0].terminated).toBe(false);
    expect(fake.workers[1].terminated).toBe(true);
  });

  it("stops trying to start a language after repeated failures, and fails fast instead", async () => {
    let attempts = 0;
    const broken: WorkerFactory = async () => {
      attempts++;
      throw new Error("traineddata 404");
    };
    const engine = createOcrEngine(broken, { maxStartAttempts: 2 });
    for (let i = 0; i < 5; i++) {
      const result = await engine.recognize(IMAGE, "ben+eng");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/could not start/);
    }
    expect(attempts).toBe(2);
  });

  it("forgets earlier start failures once a worker starts", async () => {
    const fake = fakeFactory();
    let attempts = 0;
    const flaky: WorkerFactory = async (lang) => {
      attempts++;
      if (attempts === 1 || attempts === 3) throw new Error("network blip");
      return fake.factory(lang);
    };
    const engine = createOcrEngine(flaky, { maxStartAttempts: 2, poolSize: 1 });
    expect((await engine.warmUp("ben")).ok).toBe(false);
    expect((await engine.warmUp("ben")).ok).toBe(true);
    // Kill the only worker so the next call has to start one again.
    fake.state.failRecognize = true;
    expect((await engine.recognize(IMAGE, "ben")).ok).toBe(false);
    fake.state.failRecognize = false;
    expect((await engine.recognize(IMAGE, "ben")).ok).toBe(false); // attempt 3 fails…
    expect((await engine.recognize(IMAGE, "ben")).ok).toBe(true); // …but the breaker was reset, so 4 runs
  });

  it.each([
    ["zero width", { width: 0, height: 2, data: new Uint8ClampedArray(0) }],
    ["fractional size", { width: 1.5, height: 2, data: new Uint8ClampedArray(12) }],
    ["short buffer", { width: 2, height: 2, data: new Uint8ClampedArray(15) }],
    ["over the pixel cap", { width: 5000, height: 5000, data: new Uint8ClampedArray(4) }],
  ] as Array<[string, RawImage]>)("refuses a malformed image (%s) without spending a worker on it", async (_, image) => {
    const fake = fakeFactory();
    const engine = createOcrEngine(fake.factory);
    const result = await engine.recognize(image, "ben");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("This image could not be read.");
    expect(fake.workers).toHaveLength(0);
  });

  it("clamps nonsense confidence and text from a worker into the documented ranges", async () => {
    const odd: WorkerFactory = async () => ({
      async recognize() {
        return {
          text: undefined as unknown as string,
          confidence: Number.NaN,
          words: [
            { text: "a", confidence: 140 },
            { text: "b", confidence: -3 },
            null as unknown as { text: string; confidence: number },
            { text: 7 as unknown as string, confidence: 50 },
          ],
        };
      },
      async terminate() {},
    });
    const engine = createOcrEngine(odd);
    const result = await engine.recognize(IMAGE, "ben");
    expect(result.ok && result.value).toEqual({
      text: "",
      confidence: 0,
      lang: "ben",
      words: [
        { text: "a", confidence: 100 },
        { text: "b", confidence: 0 },
      ],
    });
  });
});
