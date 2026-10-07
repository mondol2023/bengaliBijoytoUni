import { describe, expect, it } from "vitest";
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import type { OcrEngine } from "../engine/tesseract";
import { runOcrJob } from "../engine/orchestrator";
import type { ItemOutcome, OcrWorkItem } from "../engine/orchestrator";
import type { OcrLanguage, OcrRecognition, RawImage } from "../types";

const BIG: RawImage = { width: 200, height: 100, data: new Uint8ClampedArray(200 * 100 * 4) };
const SMALL: RawImage = { width: 10, height: 10, data: new Uint8ClampedArray(400) };

function pass(text: string, confidence: number, lang: OcrLanguage): OcrRecognition {
  return { text, confidence, lang, words: [] };
}

interface FakeEngine extends OcrEngine {
  calls: Array<{ image: RawImage; lang: OcrLanguage }>;
  peak: number;
}

/** `script` decides each pass by image and language; `delayMs` makes overlap observable. */
function fakeEngine(
  script: (image: RawImage, lang: OcrLanguage, call: number) => Result<OcrRecognition>,
  options: { warmUp?: Result<void>; delayMs?: number } = {},
): FakeEngine {
  let inFlight = 0;
  const engine: FakeEngine = {
    calls: [],
    peak: 0,
    async recognize(image, lang) {
      engine.calls.push({ image, lang });
      inFlight++;
      engine.peak = Math.max(engine.peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
      inFlight--;
      return script(image, lang, engine.calls.length);
    },
    async warmUp() {
      return options.warmUp ?? ok(undefined);
    },
    async dispose() {},
  };
  return engine;
}

function item(id: string, image: RawImage | null | Error = BIG): OcrWorkItem {
  return {
    id,
    async load() {
      if (image instanceof Error) throw image;
      return image;
    },
  };
}

const confident = (text: string) => () => ok(pass(text, 95, "ben"));

function done(outcome: ItemOutcome) {
  if (outcome.status !== "done") throw new Error(`expected done, got ${outcome.status}`);
  return outcome;
}

describe("runOcrJob", () => {
  it("returns one outcome per item, in input order, with normalized text", async () => {
    const engine = fakeEngine(confident("  আমি   ভাত \n\n\n\n খাই  "));
    const result = await runOcrJob([item("a"), item("b"), item("c")], engine);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cancelled).toBe(false);
    expect(result.value.outcomes.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(done(result.value.outcomes[0]).text).toBe("আমি ভাত\n\nখাই");
  });

  it("does not retry a confident Bengali pass", async () => {
    const engine = fakeEngine(confident("ভাল"));
    await runOcrJob([item("a")], engine);
    expect(engine.calls.map((c) => c.lang)).toEqual(["ben"]);
  });

  it("re-runs a poor Bengali-only pass with English and keeps the more confident one", async () => {
    const engine = fakeEngine((_image, lang) =>
      lang === "ben" ? ok(pass("gibberish", 38, "ben")) : ok(pass("The court held", 90, "ben+eng")),
    );
    const result = await runOcrJob([item("a")], engine);
    if (!result.ok) throw new Error("job failed");
    const outcome = done(result.value.outcomes[0]);
    expect(engine.calls.map((c) => c.lang)).toEqual(["ben", "ben+eng"]);
    expect(outcome.text).toBe("The court held");
    expect(outcome.lang).toBe("ben+eng");
    expect(outcome.fallback).toEqual({ needed: false });
  });

  it("keeps the first pass when the English pass is no better", async () => {
    const engine = fakeEngine((_image, lang) =>
      lang === "ben" ? ok(pass("আংশিক", 50, "ben")) : ok(pass("junk", 30, "ben+eng")),
    );
    const result = await runOcrJob([item("a")], engine);
    if (!result.ok) throw new Error("job failed");
    const outcome = done(result.value.outcomes[0]);
    expect(outcome.text).toBe("আংশিক");
    expect(outcome.fallback).toEqual({ needed: true, reason: "low-confidence" });
  });

  it("keeps the first pass when the English pass itself errors", async () => {
    const engine = fakeEngine((_image, lang) =>
      lang === "ben" ? ok(pass("আংশিক", 50, "ben")) : err(AppErrors.unknown("worker died")),
    );
    const result = await runOcrJob([item("a")], engine);
    if (!result.ok) throw new Error("job failed");
    expect(done(result.value.outcomes[0]).text).toBe("আংশিক");
  });

  it("flags empty output on a big image, but not on a tiny one", async () => {
    const engine = fakeEngine(confident("   "));
    const result = await runOcrJob([item("big", BIG), item("tiny", SMALL)], engine);
    if (!result.ok) throw new Error("job failed");
    expect(done(result.value.outcomes[0]).fallback).toEqual({ needed: true, reason: "empty-output" });
    expect(done(result.value.outcomes[1]).fallback).toEqual({ needed: false });
  });

  it("reports an image that cannot be decoded as unreadable, without calling the engine", async () => {
    const engine = fakeEngine(confident("x"));
    const result = await runOcrJob([item("a", null)], engine);
    if (!result.ok) throw new Error("job failed");
    expect(result.value.outcomes).toEqual([{ status: "unreadable", id: "a" }]);
    expect(engine.calls).toHaveLength(0);
  });

  it("keeps the good items when one image fails", async () => {
    const engine = fakeEngine((_image, _lang, call) =>
      call === 2 ? err(AppErrors.unknown("This image could not be read.")) : ok(pass("ঠিক", 95, "ben")),
    );
    const result = await runOcrJob([item("a"), item("b"), item("c")], engine, { concurrency: 1 });
    if (!result.ok) throw new Error("job failed");
    expect(result.value.outcomes.map((o) => o.status)).toEqual(["done", "failed", "done"]);
    const failed = result.value.outcomes[1];
    expect(failed.status === "failed" && failed.error.message).toBe("This image could not be read.");
  });

  it("turns a throwing loader into a failed item rather than crashing the job", async () => {
    const engine = fakeEngine(confident("ঠিক"));
    const result = await runOcrJob([item("a", new Error("canvas out of memory")), item("b")], engine);
    if (!result.ok) throw new Error("job failed");
    expect(result.value.outcomes.map((o) => o.status)).toEqual(["failed", "done"]);
    const failed = result.value.outcomes[0];
    expect(failed.status === "failed" && failed.error.message).not.toMatch(/canvas out of memory/);
  });

  it("loads images one at a time and in order, even while recognizing in parallel", async () => {
    const log: string[] = [];
    let loading = 0;
    let peakLoading = 0;
    const items: OcrWorkItem[] = ["a", "b", "c", "d"].map((id) => ({
      id,
      async load() {
        log.push(id);
        loading++;
        peakLoading = Math.max(peakLoading, loading);
        await new Promise((resolve) => setTimeout(resolve, 5));
        loading--;
        return BIG;
      },
    }));
    await runOcrJob(items, fakeEngine(confident("ঠিক"), { delayMs: 10 }), { concurrency: 2 });
    expect(log).toEqual(["a", "b", "c", "d"]);
    expect(peakLoading).toBe(1);
  });

  it("runs at most `concurrency` items at once", async () => {
    const engine = fakeEngine(confident("ঠিক"), { delayMs: 10 });
    await runOcrJob(["a", "b", "c", "d", "e"].map((id) => item(id)), engine, { concurrency: 2 });
    expect(engine.peak).toBe(2);
  });

  it("reports each outcome with running progress", async () => {
    const seen: Array<[string, number, number]> = [];
    const engine = fakeEngine(confident("ঠিক"));
    await runOcrJob([item("a"), item("b")], engine, {
      concurrency: 1,
      onItem: (outcome, progress) => seen.push([outcome.id, progress.completed, progress.total]),
    });
    expect(seen).toEqual([
      ["a", 1, 2],
      ["b", 2, 2],
    ]);
  });

  it("stops taking new items once cancelled, and returns what finished", async () => {
    const controller = new AbortController();
    const loaded: string[] = [];
    const items: OcrWorkItem[] = ["a", "b", "c", "d"].map((id) => ({
      id,
      async load() {
        loaded.push(id);
        return BIG;
      },
    }));
    const engine = fakeEngine(confident("ঠিক"));
    const result = await runOcrJob(items, engine, {
      concurrency: 1,
      signal: controller.signal,
      onItem: (outcome) => {
        if (outcome.id === "b") controller.abort();
      },
    });
    if (!result.ok) throw new Error("job failed");
    expect(result.value.cancelled).toBe(true);
    expect(result.value.outcomes.map((o) => o.id)).toEqual(["a", "b"]);
    expect(loaded).toEqual(["a", "b"]);
  });

  it("does nothing when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = fakeEngine(confident("ঠিক"));
    const result = await runOcrJob([item("a")], engine, { signal: controller.signal });
    if (!result.ok) throw new Error("job failed");
    expect(result.value).toEqual({ outcomes: [], cancelled: true });
    expect(engine.calls).toHaveLength(0);
  });

  it("fails the whole job, before reading anything, when the engine cannot start", async () => {
    let loads = 0;
    const counted: OcrWorkItem = {
      id: "a",
      async load() {
        loads++;
        return BIG;
      },
    };
    const engine = fakeEngine(confident("x"), {
      warmUp: err(AppErrors.unknown("Text recognition could not start. Check your connection and try again.")),
    });
    const result = await runOcrJob([counted], engine);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/could not start/);
    expect(loads).toBe(0);
  });

  it("reports a job with no items as an empty success", async () => {
    const result = await runOcrJob([], fakeEngine(confident("x")));
    expect(result).toEqual(ok({ outcomes: [], cancelled: false }));
  });
});
