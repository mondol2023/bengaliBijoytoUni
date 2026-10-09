/** Pure view helpers for the OCR page: copy strings and per-item presentation. */
import { OCR_MAX_FILE_BYTES } from "../config";
import type { ItemOutcome } from "../engine/orchestrator";
import type { ImproveState } from "../fallback/improvePass";
import { isMostlyBengali } from "../postprocess";
import type { OcrJobState } from "./jobState";
import type { OcrItemMeta } from "./source";

export interface ItemView {
  tone: "ok" | "check" | "ai" | "failed" | "unreadable";
  /** Always the Tesseract figure, even for an AI reading: the row labels it "local". */
  confidenceText: string | null;
  needsCheck: boolean;
  hasDigits: boolean;
  lang: "bn" | "en";
  engine: "local" | "ai";
  aiProvider: string | null;
}

const DIGITS = /[0-9০-৯]/;

/** The AI reading that replaces `outcome`'s text, if there is one. */
function improvedText(improvement: ImproveState | undefined): string | null {
  return improvement?.status === "done" ? improvement.text : null;
}

export function describeItem(outcome: ItemOutcome, improvement?: ImproveState): ItemView {
  if (outcome.status === "unreadable") {
    return {
      tone: "unreadable",
      confidenceText: null,
      needsCheck: false,
      hasDigits: false,
      lang: "en",
      engine: "local",
      aiProvider: null,
    };
  }
  if (outcome.status === "failed") {
    return {
      tone: "failed",
      confidenceText: null,
      needsCheck: false,
      hasDigits: false,
      lang: "en",
      engine: "local",
      aiProvider: null,
    };
  }
  const confidenceText = `${Math.round(outcome.confidence)}%`;
  if (improvement?.status === "done") {
    return {
      tone: "ai",
      confidenceText,
      needsCheck: false,
      hasDigits: DIGITS.test(improvement.text),
      lang: isMostlyBengali(improvement.text) ? "bn" : "en",
      engine: "ai",
      aiProvider: improvement.provider,
    };
  }
  const needsCheck = outcome.fallback.needed;
  return {
    tone: needsCheck ? "check" : "ok",
    confidenceText,
    needsCheck,
    hasDigits: DIGITS.test(outcome.text),
    lang: isMostlyBengali(outcome.text) ? "bn" : "en",
    engine: "local",
    aiProvider: null,
  };
}

/** Text of every item that read something, in input order, one blank line apart. AI text replaces the local reading. */
export function combineText(
  items: readonly OcrItemMeta[],
  outcomes: Record<string, ItemOutcome>,
  improvements: Record<string, ImproveState> = {},
): string {
  const parts: string[] = [];
  for (const item of items) {
    const outcome = outcomes[item.id];
    if (outcome?.status !== "done") continue;
    const text = improvedText(improvements[item.id]) ?? outcome.text;
    if (text.trim() !== "") parts.push(text);
  }
  return parts.join("\n\n");
}

type Unit = "line" | "page" | "image";

function unitOf(items: readonly OcrItemMeta[]): Unit {
  const first = items[0];
  if (!first || first.page === null) return "image";
  return first.box === null ? "page" : "line";
}

export function tally(state: OcrJobState): { read: number; check: number; ai: number } {
  let read = 0;
  let check = 0;
  let ai = 0;
  for (const outcome of Object.values(state.outcomes)) {
    if (outcome.status !== "done") continue;
    const improved = improvedText(state.improvements[outcome.id]);
    if (improved !== null) ai++;
    if ((improved ?? outcome.text).trim() !== "") read++;
    if (outcome.fallback.needed && improved === null) check++;
  }
  return { read, check, ai };
}

function plural(count: number, unit: Unit): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
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
      return `Reading · ${plural(state.items.length, unitOf(state.items))}`;
    case "improving":
      return `Improving ${plural(state.improveTotal, unitOf(state.items))}`;
    case "done": {
      const { read, check, ai } = tally(state);
      return `${read} read · ${check} to check${ai > 0 ? ` · ${ai} by AI` : ""}`;
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
    case "improving": {
      const settled = Object.values(state.improvements).filter((improvement) => improvement.status !== "running");
      const n = Math.min(settled.length + 1, state.improveTotal);
      return `Improving ${n} of ${state.improveTotal} with AI…`;
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
