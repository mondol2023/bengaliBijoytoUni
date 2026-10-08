/**
 * The OCR job as a pure reducer. The hook dispatches into it from async
 * callbacks, so every action carries the `jobId` it was started under and
 * anything from an older job is dropped by returning the same state object.
 */
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { ItemOutcome } from "../engine/orchestrator";
import type { OcrItemMeta, OcrSource, OcrSourcePage } from "./source";

export type OcrPhase = "idle" | "opening" | "preparing" | "reading" | "done" | "cancelled" | "error";

export interface OcrJobState {
  phase: OcrPhase;
  jobId: number;
  items: OcrItemMeta[];
  pages: OcrSourcePage[];
  outcomes: Record<string, ItemOutcome>;
  /** Ids loaded but not finished, in start order. */
  reading: string[];
  /** Item id -> blob URL. */
  previews: Record<string, string>;
  /** Page number -> blob URL. */
  pagePreviews: Record<number, string>;
  skipped: OcrSource["skipped"];
  unreadable: number;
  error: SafeErrorResponse | null;
}

export type OcrJobAction =
  | { type: "start"; jobId: number }
  | {
      type: "sourceReady";
      jobId: number;
      items: OcrItemMeta[];
      pages: OcrSourcePage[];
      skipped: OcrSource["skipped"];
      unreadable: number;
    }
  | { type: "warmed"; jobId: number }
  | { type: "itemStarted"; jobId: number; id: string }
  | { type: "preview"; jobId: number; id: string; url: string }
  | { type: "pagePreview"; jobId: number; page: number; url: string }
  | { type: "itemDone"; jobId: number; outcome: ItemOutcome }
  | { type: "finished"; jobId: number; cancelled: boolean }
  | { type: "failed"; jobId: number; error: SafeErrorResponse }
  | { type: "reset" };

export const initialOcrJobState: OcrJobState = {
  phase: "idle",
  jobId: 0,
  items: [],
  pages: [],
  outcomes: {},
  reading: [],
  previews: {},
  pagePreviews: {},
  skipped: { decorative: 0, duplicate: 0, tinyRow: 0 },
  unreadable: 0,
  error: null,
};

export function ocrJobReducer(state: OcrJobState, action: OcrJobAction): OcrJobState {
  if (action.type === "reset") return { ...initialOcrJobState, jobId: state.jobId };
  if (action.type === "start") return { ...initialOcrJobState, phase: "opening", jobId: action.jobId };
  if (action.jobId !== state.jobId) return state;
  // A reset keeps jobId, so late actions from the reset job must not revive an idle state.
  if (state.phase === "idle") return state;
  if (
    (action.type === "finished" || action.type === "failed") &&
    (state.phase === "done" || state.phase === "cancelled" || state.phase === "error")
  ) {
    return state;
  }

  switch (action.type) {
    case "sourceReady":
      return {
        ...state,
        phase: "preparing",
        items: action.items,
        pages: action.pages,
        skipped: action.skipped,
        unreadable: action.unreadable,
      };
    case "warmed":
      return { ...state, phase: "reading" };
    case "itemStarted":
      return state.reading.includes(action.id) ? state : { ...state, reading: [...state.reading, action.id] };
    case "preview":
      return { ...state, previews: { ...state.previews, [action.id]: action.url } };
    case "pagePreview":
      return { ...state, pagePreviews: { ...state.pagePreviews, [action.page]: action.url } };
    case "itemDone":
      return {
        ...state,
        reading: state.reading.filter((id) => id !== action.outcome.id),
        outcomes: { ...state.outcomes, [action.outcome.id]: action.outcome },
      };
    case "finished":
      return { ...state, phase: action.cancelled ? "cancelled" : "done", reading: [] };
    case "failed":
      return { ...state, phase: "error", error: action.error, reading: [] };
  }
}

/** Every blob URL the state holds, for the hook to revoke. */
export function blobUrlsOf(state: OcrJobState): string[] {
  return [...Object.values(state.previews), ...Object.values(state.pagePreviews)];
}
