import { describe, expect, it } from "vitest";
import type { DoneOutcome, ItemOutcome } from "../engine/orchestrator";
import type { ImproveState } from "../fallback/improvePass";
import { buildLayout, layoutText } from "../job/layout";
import type { OcrItemMeta } from "../job/source";
import type { Box } from "../types";

const done = (id: string, text: string): DoneOutcome => ({
  status: "done",
  id,
  text,
  confidence: 90,
  lang: "ben",
  words: [],
  fallback: { needed: false },
  imagePixels: 100,
});

/** A 10pt-tall row on page `page`, at `y`, from `x` to `x + width`. */
const row = (id: string, page: number, y: number, x = 50, width = 400): OcrItemMeta => ({
  id,
  label: id,
  page,
  box: { x, y, width, height: 10 } satisfies Box,
});

function outcomesOf(entries: Array<[string, string]>): Record<string, ItemOutcome> {
  return Object.fromEntries(entries.map(([id, text]) => [id, done(id, text)]));
}

const shape = (pages: ReturnType<typeof buildLayout>) =>
  pages.map((page) => page.paragraphs.map((paragraph) => paragraph.lines.map((line) => line.text)));

describe("buildLayout — placed rows", () => {
  it("keeps tightly spaced rows in one paragraph and splits on a wide gap", () => {
    const items = [row("a", 1, 100), row("b", 1, 114), row("c", 1, 150), row("d", 1, 164)];
    const outcomes = outcomesOf([["a", "এক"], ["b", "দুই"], ["c", "তিন"], ["d", "চার"]]);
    expect(shape(buildLayout(items, outcomes))).toEqual([[["এক", "দুই"], ["তিন", "চার"]]]);
  });

  it("starts a paragraph at a first-line indent", () => {
    const items = [row("a", 1, 100, 50), row("b", 1, 114, 50), row("c", 1, 128, 80, 370), row("d", 1, 142, 50)];
    const outcomes = outcomesOf([["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"]]);
    const pages = buildLayout(items, outcomes);
    expect(shape(pages)).toEqual([[["a", "b"], ["c", "d"]]]);
    expect(pages[0].paragraphs[1].lines[0].indent).toBeGreaterThan(0);
    expect(pages[0].paragraphs[1].lines[1].indent).toBe(0);
  });

  it("sets a centred heading apart from the body", () => {
    const items = [row("h", 1, 80, 200, 100), row("a", 1, 94, 50), row("b", 1, 108, 50)];
    const outcomes = outcomesOf([["h", "শিরোনাম"], ["a", "a"], ["b", "b"]]);
    const pages = buildLayout(items, outcomes);
    expect(shape(pages)).toEqual([[["শিরোনাম"], ["a", "b"]]]);
    expect(pages[0].paragraphs[0].align).toBe("center");
    expect(pages[0].paragraphs[1].align).toBe("start");
  });

  it("groups by page, skips rows with nothing read, and prefers the AI reading", () => {
    const items = [row("a", 1, 100), row("b", 1, 114), row("c", 2, 100)];
    const outcomes: Record<string, ItemOutcome> = {
      a: done("a", "local"),
      b: { status: "unreadable", id: "b" },
      c: done("c", "two"),
    };
    const improvements: Record<string, ImproveState> = {
      a: { status: "done", text: "ai", provider: "gemini", model: "m" },
    };
    const pages = buildLayout(items, outcomes, improvements);
    expect(pages.map((page) => page.label)).toEqual(["Page 1", "Page 2"]);
    expect(shape(pages)).toEqual([[["ai"]], [["two"]]]);
    expect(pages[0].paragraphs[0].lines[0].engine).toBe("ai");
  });

  it("marks each line's language", () => {
    const items = [row("a", 1, 100), row("b", 1, 114)];
    const pages = buildLayout(items, outcomesOf([["a", "বাংলা"], ["b", "Case No. 12"]]));
    expect(pages[0].paragraphs[0].lines.map((line) => line.lang)).toEqual(["bn", "en"]);
  });
});

describe("buildLayout — whole pages and images", () => {
  it("keeps the engine's line and paragraph breaks", () => {
    const items: OcrItemMeta[] = [{ id: "page-1", label: "Page 1", page: 1, box: null }];
    const pages = buildLayout(items, outcomesOf([["page-1", "এক\nদুই\n\nতিন"]]));
    expect(shape(pages)).toEqual([[["এক", "দুই"], ["তিন"]]]);
  });

  it("labels DOCX images by their own label", () => {
    const items: OcrItemMeta[] = [
      { id: "img-1", label: "Image 1", page: null, box: null },
      { id: "img-2", label: "Image 2", page: null, box: null },
    ];
    const pages = buildLayout(items, outcomesOf([["img-1", "a"], ["img-2", "  "]]));
    expect(pages.map((page) => page.label)).toEqual(["Image 1"]);
  });

  it("returns nothing when nothing was read", () => {
    expect(buildLayout([row("a", 1, 100)], {})).toEqual([]);
  });
});

describe("layoutText", () => {
  it("joins lines by newline, paragraphs by a blank line, and pages by two", () => {
    const items = [row("a", 1, 100), row("b", 1, 114), row("c", 1, 150), row("d", 2, 100)];
    const pages = buildLayout(items, outcomesOf([["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"]]));
    expect(layoutText(pages)).toBe("a\nb\n\nc\n\n\nd");
  });
});
