import { describe, expect, it } from "vitest";
import { AppErrors } from "@/lib/errors/types";
import type { DoneOutcome, ItemOutcome } from "../engine/orchestrator";
import type { ImproveState } from "../fallback/improvePass";
import { initialOcrJobState } from "../job/jobState";
import type { OcrJobState } from "../job/jobState";
import { combineText, describeItem, jobMarker, ocrDownloadName, previewSize, stageLine } from "../job/view";

const done = (id: string, text: string, extra: Partial<DoneOutcome> = {}): DoneOutcome => ({
  status: "done",
  id,
  text,
  confidence: 90,
  lang: "ben",
  words: [],
  fallback: { needed: false },
  imagePixels: 100,
  ...extra,
});
const meta = (id: string, page: number | null) => ({ id, label: id, page, box: null });
const CHECK = { needed: true, reason: "low-confidence" } as const;

describe("describeItem", () => {
  it("maps a good Bengali read", () => {
    expect(describeItem(done("a", "ঠিক", { confidence: 93.6 }))).toEqual({
      tone: "ok",
      confidenceText: "94%",
      needsCheck: false,
      hasDigits: false,
      lang: "bn",
      engine: "local",
      aiProvider: null,
    });
  });
  it("flags fallback.needed as check", () => {
    const view = describeItem(done("a", "ঠিক", { fallback: CHECK }));
    expect(view.tone).toBe("check");
    expect(view.needsCheck).toBe(true);
  });
  it("detects Bengali and ASCII digits and English text", () => {
    expect(describeItem(done("a", "নং ৪৫/২০২৫")).hasDigits).toBe(true);
    const en = describeItem(done("a", "No. 45"));
    expect(en.hasDigits).toBe(true);
    expect(en.lang).toBe("en");
  });
  it("maps unreadable and failed with no confidence", () => {
    expect(describeItem({ status: "unreadable", id: "a" })).toMatchObject({
      tone: "unreadable",
      confidenceText: null,
    });
    expect(describeItem({ status: "failed", id: "a", error: AppErrors.unknown("x") })).toMatchObject({
      tone: "failed",
      confidenceText: null,
    });
  });
});

const AI = (text: string): ImproveState => ({ status: "done", text, provider: "gemini", model: "m" });

describe("describeItem with an improvement", () => {
  const weak = done("a", "No. 4S", { confidence: 41.4, fallback: CHECK });

  it("shows the improved text's view: ai tone, not needing a check, local confidence kept", () => {
    expect(describeItem(weak, AI("নং ৪৫"))).toEqual({
      tone: "ai",
      confidenceText: "41%",
      needsCheck: false,
      hasDigits: true,
      lang: "bn",
      engine: "ai",
      aiProvider: "gemini",
    });
  });
  it("recomputes lang and digits from the improved text, not the Tesseract text", () => {
    const view = describeItem(done("a", "নং ৪৫", { fallback: CHECK }), AI("Plain words"));
    expect(view.lang).toBe("en");
    expect(view.hasDigits).toBe(false);
  });
  it("ignores a running or failed improvement", () => {
    for (const improvement of [{ status: "running" }, { status: "failed", message: "x" }] as const) {
      expect(describeItem(weak, improvement)).toMatchObject({ tone: "check", needsCheck: true, engine: "local" });
    }
  });
  it("ignores an improvement for an item that was not read", () => {
    expect(describeItem({ status: "unreadable", id: "a" }, AI("x")).tone).toBe("unreadable");
  });
});

describe("combineText", () => {
  const items = [meta("a", 1), meta("b", 1), meta("c", 1), meta("d", 1)];
  it("uses improved text where present and local text elsewhere", () => {
    const outcomes: Record<string, ItemOutcome> = { a: done("a", "এক"), b: done("b", "দুই"), c: done("c", "") };
    const improvements: Record<string, ImproveState> = {
      b: AI("দুই ঠিক"),
      c: AI("তিন"),
      d: { status: "failed", message: "x" },
    };
    expect(combineText(items, outcomes, improvements)).toBe("এক\n\nদুই ঠিক\n\nতিন");
  });
  it("ignores a running improvement", () => {
    expect(combineText(items, { a: done("a", "এক") }, { a: { status: "running" } })).toBe("এক");
  });
  it("keeps input order, skips empty/unreadable/failed, joins with blank line", () => {
    const outcomes: Record<string, ItemOutcome> = {
      d: done("d", "চার"),
      a: done("a", "এক"),
      b: done("b", ""),
      c: { status: "unreadable", id: "c" },
    };
    expect(combineText(items, outcomes)).toBe("এক\n\nচার");
  });
  it("returns empty string when nothing was read", () => {
    expect(combineText(items, {})).toBe("");
    expect(combineText(items, { a: { status: "failed", id: "a", error: AppErrors.unknown("x") } })).toBe("");
  });
});

function state(partial: Partial<OcrJobState>): OcrJobState {
  return { ...initialOcrJobState, ...partial };
}
const row = (id: string) => ({ ...meta(id, 1), box: { x: 0, y: 0, width: 10, height: 5 } });
const lines = [row("a"), row("b"), row("c")];

describe("jobMarker", () => {
  it("idle shows the formats and the cap", () => {
    expect(jobMarker(state({}))).toBe("pdf · docx · 15 MB");
  });
  it("preparing", () => {
    expect(jobMarker(state({ phase: "preparing" }))).toBe("Preparing");
  });
  it("reading is fixed per mode and does not change with progress", () => {
    const base = { phase: "reading" as const, items: lines };
    expect(jobMarker(state(base))).toBe("Reading · 3 lines");
    expect(jobMarker(state({ ...base, outcomes: { a: done("a", "x") } }))).toBe("Reading · 3 lines");
    expect(jobMarker(state({ phase: "reading", items: [meta("page-1", 1), meta("page-2", 2)] }))).toBe(
      "Reading · 2 pages",
    );
    expect(jobMarker(state({ phase: "reading", items: [meta("img-1", null)] }))).toBe("Reading · 1 image");
  });
  it("done and cancelled", () => {
    const outcomes: Record<string, ItemOutcome> = {
      a: done("a", "x"),
      b: done("b", "y", { fallback: CHECK }),
      c: { status: "unreadable", id: "c" },
    };
    expect(jobMarker(state({ phase: "done", items: lines, outcomes }))).toBe("2 read · 1 to check");
    expect(jobMarker(state({ phase: "cancelled", items: lines, outcomes }))).toBe("Stopped · 2 read");
  });
  it("error phase", () => {
    const outcomes: Record<string, ItemOutcome> = { a: done("a", "x") };
    expect(jobMarker(state({ phase: "error", items: lines, outcomes }))).toBe("Stopped · 1 read");
  });
  it("improving is fixed at the pass size and does not change per item", () => {
    const base = { phase: "improving" as const, items: lines, improveTotal: 3 };
    expect(jobMarker(state(base))).toBe("Improving 3 lines");
    expect(jobMarker(state({ ...base, improvements: { a: AI("x") } }))).toBe("Improving 3 lines");
    expect(jobMarker(state({ ...base, improveTotal: 1 }))).toBe("Improving 1 line");
    expect(jobMarker(state({ phase: "improving", items: [meta("page-1", 1)], improveTotal: 2 }))).toBe(
      "Improving 2 pages",
    );
  });
  it("done adds the AI count only when there is one, and an improved line is no longer to check", () => {
    const outcomes: Record<string, ItemOutcome> = {
      a: done("a", "x"),
      b: done("b", "y", { fallback: CHECK }),
      c: done("c", "z", { fallback: CHECK }),
    };
    expect(jobMarker(state({ phase: "done", items: lines, outcomes }))).toBe("3 read · 2 to check");
    const improvements = { b: AI("y2"), c: { status: "failed", message: "x" } } as const;
    expect(jobMarker(state({ phase: "done", items: lines, outcomes, improvements }))).toBe(
      "3 read · 1 to check · 1 by AI",
    );
  });
  it("counts an empty local reading that AI filled as read", () => {
    const outcomes: Record<string, ItemOutcome> = { a: done("a", "", { fallback: CHECK }) };
    expect(jobMarker(state({ phase: "done", items: lines, outcomes }))).toBe("0 read · 1 to check");
    expect(jobMarker(state({ phase: "done", items: lines, outcomes, improvements: { a: AI("পড়া") } }))).toBe(
      "1 read · 0 to check · 1 by AI",
    );
  });
});

describe("stageLine", () => {
  it("opening and preparing", () => {
    expect(stageLine(state({ phase: "opening" }))).toBe("Opening the file…");
    expect(stageLine(state({ phase: "preparing" }))).toBe("Preparing the reader…");
  });
  it("is empty outside opening/preparing/reading", () => {
    for (const phase of ["idle", "done", "cancelled", "error"] as const) {
      expect(stageLine(state({ phase, items: lines }))).toBe("");
    }
  });
  it("reading per mode, n = completed + 1 capped at total", () => {
    expect(stageLine(state({ phase: "reading", items: lines }))).toBe("Reading line 1 of 3");
    const two = { a: done("a", "x"), b: done("b", "y") };
    expect(stageLine(state({ phase: "reading", items: lines, outcomes: two }))).toBe("Reading line 3 of 3");
    const all = { ...two, c: done("c", "z") };
    expect(stageLine(state({ phase: "reading", items: lines, outcomes: all }))).toBe("Reading line 3 of 3");
    expect(stageLine(state({ phase: "reading", items: [meta("page-1", 1), meta("page-2", 2)] }))).toBe(
      "Reading page 1 of 2",
    );
    expect(stageLine(state({ phase: "reading", items: [meta("img-1", null)] }))).toBe("Reading image 1 of 1");
  });
  it("improving: n = settled + 1, capped at the total", () => {
    const base = { phase: "improving" as const, items: lines, improveTotal: 3 };
    const running = { status: "running" } as const;
    const failed = { status: "failed", message: "x" } as const;
    expect(stageLine(state({ ...base, improvements: { a: running, b: running, c: running } }))).toBe(
      "Improving 1 of 3 with AI…",
    );
    expect(stageLine(state({ ...base, improvements: { a: AI("x"), b: failed, c: running } }))).toBe(
      "Improving 3 of 3 with AI…",
    );
    expect(stageLine(state({ ...base, improvements: { a: AI("x"), b: AI("y"), c: AI("z") } }))).toBe(
      "Improving 3 of 3 with AI…",
    );
  });
});

describe("previewSize", () => {
  it("scales the long edge down", () => {
    expect(previewSize(3500, 138, 1600)).toEqual({ width: 1600, height: 63 });
  });
  it("leaves small images alone and never returns 0", () => {
    expect(previewSize(200, 100, 1600)).toEqual({ width: 200, height: 100 });
    expect(previewSize(10000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe("ocrDownloadName", () => {
  it("swaps the last extension for .ocr.txt", () => {
    expect(ocrDownloadName("scan.final.pdf")).toBe("scan.final.ocr.txt");
    expect(ocrDownloadName("noext")).toBe("noext.ocr.txt");
  });
});
