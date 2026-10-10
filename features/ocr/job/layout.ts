/**
 * Rebuilds the document's own shape (pages → paragraphs → lines) from what was read, for the
 * "As laid out" sheet. Pure and isomorphic, like the rest of `job/view.ts`.
 *
 * Embedded PDF rows carry their box on the page, so paragraphs are inferred from geometry: a
 * vertical gap wider than a fraction of a line, a first-line indent, or a change between centred
 * and left-set text. Whole pages and DOCX images have no boxes; Tesseract's own output already
 * separates lines with "\n" and blocks with a blank line, and `normalizeOcrText` keeps both.
 */
import type { ItemOutcome } from "../engine/orchestrator";
import type { ImproveState } from "../fallback/improvePass";
import { isMostlyBengali } from "../postprocess";
import type { Box } from "../types";
import type { OcrItemMeta } from "./source";

export interface LayoutLine {
  id: string;
  text: string;
  lang: "bn" | "en";
  engine: "local" | "ai";
  /** Left indent as a share of the page's text column, 0..MAX_INDENT. Always 0 when centred. */
  indent: number;
}

export interface LayoutParagraph {
  align: "start" | "center";
  lines: LayoutLine[];
}

export interface LayoutPage {
  key: string;
  /** "Page 3" | "Image 5" */
  label: string;
  paragraphs: LayoutParagraph[];
}

/** A gap between rows wider than this many line heights starts a paragraph. */
const PARAGRAPH_GAP = 0.75;
/** A row starting this many line heights right of the column's edge is indented. */
const INDENT_MIN = 0.5;
/** Centred: both margins at least this many line heights, and within one line height of each other. */
const CENTER_MARGIN = 2;
/** Deep indents are almost always tab-stopped fields; past this they are shown capped. */
const MAX_INDENT = 0.6;

interface ReadRow {
  item: OcrItemMeta;
  text: string;
  engine: "local" | "ai";
}

function readText(
  item: OcrItemMeta,
  outcomes: Record<string, ItemOutcome>,
  improvements: Record<string, ImproveState>,
): ReadRow | null {
  const outcome = outcomes[item.id];
  if (outcome?.status !== "done") return null;
  const improvement = improvements[item.id];
  const ai = improvement?.status === "done";
  const text = ai ? improvement.text : outcome.text;
  return text.trim() === "" ? null : { item, text, engine: ai ? "ai" : "local" };
}

function makeLine(id: string, text: string, engine: "local" | "ai", indent = 0): LayoutLine {
  return { id, text, lang: isMostlyBengali(text) ? "bn" : "en", engine, indent };
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Placed rows of one page, already in reading order. */
function layoutPlacedRows(rows: ReadRow[]): LayoutParagraph[] {
  const boxes = rows.map((row) => row.item.box as Box);
  const lineHeight = Math.max(1, median(boxes.map((box) => box.height)));
  const left = Math.min(...boxes.map((box) => box.x));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const columnWidth = Math.max(1, right - left);

  const paragraphs: LayoutParagraph[] = [];
  let previous: Box | null = null;
  let previousIndented = false;

  rows.forEach((row, index) => {
    const box = boxes[index];
    const leftMargin = box.x - left;
    const rightMargin = right - (box.x + box.width);
    const centered =
      leftMargin >= CENTER_MARGIN * lineHeight &&
      rightMargin >= CENTER_MARGIN * lineHeight &&
      Math.abs(leftMargin - rightMargin) <= lineHeight;
    const indented = !centered && leftMargin > INDENT_MIN * lineHeight;
    const align = centered ? "center" : "start";

    const current = paragraphs.at(-1);
    const gap = previous ? box.y - (previous.y + previous.height) : 0;
    const startsParagraph =
      !current ||
      current.align !== align ||
      gap > PARAGRAPH_GAP * lineHeight ||
      (indented && !previousIndented);

    const indent = centered ? 0 : Math.min(MAX_INDENT, leftMargin / columnWidth);
    const lines = splitLines(row.text).map((text, part) =>
      makeLine(part === 0 ? row.item.id : `${row.item.id}:${part}`, text, row.engine, indent),
    );
    if (startsParagraph) paragraphs.push({ align, lines });
    else current.lines.push(...lines);

    previous = box;
    previousIndented = indented;
  });
  return paragraphs;
}

/** Text the engine read as a block: blank lines are paragraph breaks, single newlines line breaks. */
function layoutBlock(row: ReadRow): LayoutParagraph[] {
  return row.text
    .split(/\n\s*\n/)
    .map((block, index) => ({
      align: "start" as const,
      lines: splitLines(block).map((text, line) => makeLine(`${row.item.id}:${index}:${line}`, text, row.engine)),
    }))
    .filter((paragraph) => paragraph.lines.length > 0);
}

/** Pages (or DOCX images) in input order, each with only the paragraphs that hold read text. */
export function buildLayout(
  items: readonly OcrItemMeta[],
  outcomes: Record<string, ItemOutcome>,
  improvements: Record<string, ImproveState> = {},
): LayoutPage[] {
  const groups = new Map<string, { label: string; rows: ReadRow[] }>();
  for (const item of items) {
    const row = readText(item, outcomes, improvements);
    if (!row) continue;
    const key = item.page === null ? item.id : `page-${item.page}`;
    const label = item.page === null ? item.label : `Page ${item.page}`;
    const group = groups.get(key) ?? { label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const pages: LayoutPage[] = [];
  for (const [key, { label, rows }] of groups) {
    const placed = rows.filter((row) => row.item.box !== null);
    const paragraphs = [
      ...(placed.length > 0 ? layoutPlacedRows(placed) : []),
      ...rows.filter((row) => row.item.box === null).flatMap(layoutBlock),
    ];
    if (paragraphs.length > 0) pages.push({ key, label, paragraphs });
  }
  return pages;
}

/** Plain text in the same shape: lines by newline, paragraphs by a blank line, pages by two. */
export function layoutText(pages: readonly LayoutPage[]): string {
  return pages
    .map((page) => page.paragraphs.map((paragraph) => paragraph.lines.map((line) => line.text).join("\n")).join("\n\n"))
    .join("\n\n\n");
}
