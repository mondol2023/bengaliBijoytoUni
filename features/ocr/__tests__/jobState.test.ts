import { describe, expect, it } from "vitest";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { ItemOutcome } from "../engine/orchestrator";
import { blobUrlsOf, initialOcrJobState, ocrJobReducer } from "../job/jobState";
import type { OcrJobAction, OcrJobState } from "../job/jobState";

const ITEMS = [
  { id: "p1-r1", label: "Page 1 · line 1", page: 1, box: null },
  { id: "p1-r2", label: "Page 1 · line 2", page: 1, box: null },
];
const PAGES = [{ page: 1, widthPt: 600, heightPt: 800 }];
const SKIPPED = { decorative: 1, duplicate: 0, tinyRow: 2 };
const ERROR = { code: "X", message: "boom" } as unknown as SafeErrorResponse;
const done = (id: string): ItemOutcome => ({
  status: "done",
  id,
  text: "ঠিক",
  confidence: 90,
  lang: "ben",
  words: [],
  fallback: { needed: false },
  imagePixels: 100,
});

function started(jobId = 1): OcrJobState {
  return ocrJobReducer(initialOcrJobState, { type: "start", jobId });
}

describe("ocrJobReducer", () => {
  it("returns the same object for any action carrying a stale jobId", () => {
    const state = started(2);
    const actions: OcrJobAction[] = [
      { type: "sourceReady", jobId: 1, items: ITEMS, pages: PAGES, skipped: SKIPPED, unreadable: 0 },
      { type: "warmed", jobId: 1 },
      { type: "itemStarted", jobId: 1, id: "p1-r1" },
      { type: "preview", jobId: 1, id: "p1-r1", url: "blob:a" },
      { type: "pagePreview", jobId: 1, page: 1, url: "blob:b" },
      { type: "itemDone", jobId: 1, outcome: done("p1-r1") },
      { type: "finished", jobId: 1, cancelled: false },
      { type: "failed", jobId: 1, error: ERROR },
    ];
    for (const action of actions) expect(ocrJobReducer(state, action)).toBe(state);
  });

  it("start clears outcomes, previews and error and enters opening", () => {
    let state = started(1);
    state = ocrJobReducer(state, { type: "preview", jobId: 1, id: "a", url: "blob:a" });
    state = ocrJobReducer(state, { type: "itemDone", jobId: 1, outcome: done("a") });
    state = ocrJobReducer(state, { type: "failed", jobId: 1, error: ERROR });
    const next = ocrJobReducer(state, { type: "start", jobId: 2 });
    expect(next).toEqual({ ...initialOcrJobState, phase: "opening", jobId: 2 });
  });

  it("walks sourceReady then warmed", () => {
    let state = started(1);
    state = ocrJobReducer(state, {
      type: "sourceReady",
      jobId: 1,
      items: ITEMS,
      pages: PAGES,
      skipped: SKIPPED,
      unreadable: 3,
    });
    expect(state).toMatchObject({ phase: "preparing", items: ITEMS, pages: PAGES, skipped: SKIPPED, unreadable: 3 });
    state = ocrJobReducer(state, { type: "warmed", jobId: 1 });
    expect(state.phase).toBe("reading");
  });

  it("itemStarted appends to reading; itemDone removes it and stores the outcome", () => {
    let state = started(1);
    state = ocrJobReducer(state, { type: "itemStarted", jobId: 1, id: "a" });
    state = ocrJobReducer(state, { type: "itemStarted", jobId: 1, id: "b" });
    expect(state.reading).toEqual(["a", "b"]);
    state = ocrJobReducer(state, { type: "itemDone", jobId: 1, outcome: done("a") });
    expect(state.reading).toEqual(["b"]);
    expect(state.outcomes.a?.status).toBe("done");
  });

  it("stores previews and page previews", () => {
    let state = started(1);
    state = ocrJobReducer(state, { type: "preview", jobId: 1, id: "a", url: "blob:a" });
    state = ocrJobReducer(state, { type: "pagePreview", jobId: 1, page: 2, url: "blob:p2" });
    expect(state.previews).toEqual({ a: "blob:a" });
    expect(state.pagePreviews).toEqual({ 2: "blob:p2" });
  });

  it("finished maps cancelled to cancelled and otherwise done", () => {
    expect(ocrJobReducer(started(1), { type: "finished", jobId: 1, cancelled: true }).phase).toBe("cancelled");
    expect(ocrJobReducer(started(1), { type: "finished", jobId: 1, cancelled: false }).phase).toBe("done");
  });

  it("failed goes to error and keeps partial outcomes", () => {
    let state = started(1);
    state = ocrJobReducer(state, { type: "itemDone", jobId: 1, outcome: done("a") });
    state = ocrJobReducer(state, { type: "failed", jobId: 1, error: ERROR });
    expect(state.phase).toBe("error");
    expect(state.error).toBe(ERROR);
    expect(Object.keys(state.outcomes)).toEqual(["a"]);
  });

  it("reset returns to initial but keeps jobId so late actions stay stale", () => {
    const state = ocrJobReducer(started(5), { type: "reset" });
    expect(state).toEqual({ ...initialOcrJobState, jobId: 5 });
    expect(ocrJobReducer(state, { type: "warmed", jobId: 4 })).toBe(state);
  });

  it("ignores every job action after reset while idle", () => {
    let running = started(3);
    running = ocrJobReducer(running, { type: "itemStarted", jobId: 3, id: "a" });
    const idle = ocrJobReducer(running, { type: "reset" });
    const actions: OcrJobAction[] = [
      { type: "sourceReady", jobId: 3, items: ITEMS, pages: PAGES, skipped: SKIPPED, unreadable: 0 },
      { type: "warmed", jobId: 3 },
      { type: "itemStarted", jobId: 3, id: "a" },
      { type: "preview", jobId: 3, id: "a", url: "blob:a" },
      { type: "pagePreview", jobId: 3, page: 1, url: "blob:b" },
      { type: "itemDone", jobId: 3, outcome: done("a") },
      { type: "finished", jobId: 3, cancelled: false },
      { type: "failed", jobId: 3, error: ERROR },
    ];
    for (const action of actions) {
      const next = ocrJobReducer(idle, action);
      expect(next).toBe(idle);
      expect(next.phase).toBe("idle");
    }
  });

  it("finished and failed do not overwrite a terminal phase", () => {
    const failed = ocrJobReducer(started(1), { type: "failed", jobId: 1, error: ERROR });
    expect(ocrJobReducer(failed, { type: "finished", jobId: 1, cancelled: false })).toBe(failed);
    const finished = ocrJobReducer(started(1), { type: "finished", jobId: 1, cancelled: false });
    expect(ocrJobReducer(finished, { type: "failed", jobId: 1, error: ERROR })).toBe(finished);
    const cancelled = ocrJobReducer(started(1), { type: "finished", jobId: 1, cancelled: true });
    expect(ocrJobReducer(cancelled, { type: "finished", jobId: 1, cancelled: false })).toBe(cancelled);
  });

  it("duplicate itemStarted returns the same state", () => {
    const state = ocrJobReducer(started(1), { type: "itemStarted", jobId: 1, id: "a" });
    expect(ocrJobReducer(state, { type: "itemStarted", jobId: 1, id: "a" })).toBe(state);
  });

  it("start mid-run clears outcomes, previews, reading and error", () => {
    let state = started(1);
    state = ocrJobReducer(state, { type: "itemStarted", jobId: 1, id: "a" });
    state = ocrJobReducer(state, { type: "preview", jobId: 1, id: "a", url: "blob:a" });
    state = ocrJobReducer(state, { type: "itemDone", jobId: 1, outcome: done("b") });
    state = ocrJobReducer(state, { type: "itemStarted", jobId: 1, id: "c" });
    const next = ocrJobReducer(state, { type: "start", jobId: 2 });
    expect(next).toMatchObject({ phase: "opening", jobId: 2, outcomes: {}, previews: {}, reading: [], error: null });
  });

  it("does not mutate the previous state", () => {
    let state = started(1);
    state = ocrJobReducer(state, { type: "itemStarted", jobId: 1, id: "a" });
    const snapshot = structuredClone(state);
    ocrJobReducer(state, { type: "itemDone", jobId: 1, outcome: done("a") });
    ocrJobReducer(state, { type: "preview", jobId: 1, id: "a", url: "blob:a" });
    ocrJobReducer(state, { type: "pagePreview", jobId: 1, page: 1, url: "blob:p" });
    ocrJobReducer(state, { type: "itemStarted", jobId: 1, id: "b" });
    ocrJobReducer(state, { type: "finished", jobId: 1, cancelled: true });
    expect(state).toEqual(snapshot);
  });

  it("blobUrlsOf returns every item and page preview URL", () => {
    let state = started(1);
    state = ocrJobReducer(state, { type: "preview", jobId: 1, id: "a", url: "blob:a" });
    state = ocrJobReducer(state, { type: "pagePreview", jobId: 1, page: 1, url: "blob:p1" });
    expect(blobUrlsOf(state).sort()).toEqual(["blob:a", "blob:p1"]);
  });
});
