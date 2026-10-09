/** Pure view helpers for the OCR page: copy strings and per-item presentation. */
import { OCR_MAX_FILE_BYTES } from "../config";
import type { ItemOutcome } from "../engine/orchestrator";
import { isMostlyBengali } from "../postprocess";
import type { OcrJobState } from "./jobState";
import type { OcrItemMeta } from "./source";

export interface ItemView {
  tone: "ok" | "check" | "failed" | "unreadable";
  confidenceText: string | null;
  needsCheck: boolean;
  hasDigits: boolean;
  lang: "bn" | "en";
}

const DIGITS = /[0-9০-৯]/;

export function describeItem(outcome: ItemOutcome): ItemView {
  if (outcome.status === "unreadable") {
    return { tone: "unreadable", confidenceText: null, needsCheck: false, hasDigits: false, lang: "en" };
  }
  if (outcome.status === "failed") {
    return { tone: "failed", confidenceText: null, needsCheck: false, hasDigits: false, lang: "en" };
  }
  const needsCheck = outcome.fallback.needed;
  return {
    tone: needsCheck ? "check" : "ok",
    confidenceText: `${Math.round(outcome.confidence)}%`,
    needsCheck,
    hasDigits: DIGITS.test(outcome.text),
    lang: isMostlyBengali(outcome.text) ? "bn" : "en",
  };
}

/** Text of every item that read something, in input order, one blank line apart. */
export function combineText(items: readonly OcrItemMeta[], outcomes: Record<string, ItemOutcome>): string {
  const parts: string[] = [];
  for (const item of items) {
    const outcome = outcomes[item.id];
    if (outcome?.status === "done" && outcome.text.trim() !== "") parts.push(outcome.text);
  }
  return parts.join("\n\n");
}

type Unit = "line" | "page" | "image";

function unitOf(items: readonly OcrItemMeta[]): Unit {
  const first = items[0];
  if (!first || first.page === null) return "image";
  return first.box === null ? "page" : "line";
}

function tally(state: OcrJobState): { read: number; check: number } {
  let read = 0;
  let check = 0;
  for (const outcome of Object.values(state.outcomes)) {
    if (outcome.status !== "done") continue;
    if (outcome.text.trim() !== "") read++;
    if (outcome.fallback.needed) check++;
  }
  return { read, check };
}

/** ToolHead marker (aria-live): never changes per item while reading. */
export function jobMarker(state: OcrJobState): string {
  switch (state.phase) {
    case "idle":
      return `pdf · docx · ${Math.round(OCR_MAX_FILE_BYTES / (1024 * 1024))} MB`;
    case "opening":
    case "preparing":
      return "Preparing";
    case "reading":
      return `Reading · ${state.items.length} ${unitOf(state.items)}${state.items.length === 1 ? "" : "s"}`;
    case "done": {
      const { read, check } = tally(state);
      return `${read} read · ${check} to check`;
    }
    case "cancelled":
    case "error":
      return `Stopped · ${tally(state).read} read`;
  }
}

export function stageLine(state: OcrJobState): string {
  switch (state.phase) {
    case "opening":
      return "Opening the file…";
    case "preparing":
      return "Preparing the reader…";
    case "reading": {
      const total = state.items.length;
      const n = Math.min(Object.keys(state.outcomes).length + 1, total);
      return `Reading ${unitOf(state.items)} ${n} of ${total}`;
    }
    default:
      return "";
  }
}

/** Scales down so the long edge is at most `maxEdge`; never up, never to 0. */
export function previewSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function ocrDownloadName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem}.ocr.txt`;
}
