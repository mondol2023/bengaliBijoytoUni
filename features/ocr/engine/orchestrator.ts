/**
 * Runs one OCR job: for each item, decode the image, read it with Tesseract
 * (Bengali first, English retry if that came back poor), decide whether it
 * should go to the AI fallback, and report. Pure orchestration over an
 * injected `OcrEngine`, so it runs the same against fakes in vitest and
 * against real workers in the browser.
 *
 * Images are *decoded one at a time, in order* (the PDF row renderer re-reads
 * a page's operator list whenever the page changes, so interleaved loads would
 * thrash it) but *recognized in parallel* up to `concurrency`. A pixel buffer
 * is dropped as soon as its item finishes, so a long scan never sits in memory.
 */
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { AppError, Result } from "@/lib/errors/types";
import { OCR_WORKER_POOL_SIZE } from "../config";
import { normalizeOcrText } from "../postprocess";
import type { FallbackDecision, OcrLanguage, OcrRecognition, OcrWord, RawImage } from "../types";
import { assessFallback, needsEnglishRetry, pickBetterRecognition } from "./confidence";
import type { OcrEngine } from "./tesseract";

export interface OcrWorkItem {
  id: string;
  /** Decodes the pixels, or null when the image cannot be decoded. May throw. */
  load(): Promise<RawImage | null>;
}

export interface DoneOutcome {
  status: "done";
  id: string;
  /** Normalized (NFC, tidy whitespace). May be empty. */
  text: string;
  confidence: number;
  lang: OcrLanguage;
  words: readonly OcrWord[];
  fallback: FallbackDecision;
  /** Decoded area, so the UI can tell a 100 × 100 icon from a page. */
  imagePixels: number;
}

export type ItemOutcome =
  | DoneOutcome
  | { status: "unreadable"; id: string }
  | { status: "failed"; id: string; error: AppError };

export interface JobProgress {
  completed: number;
  total: number;
}

export interface JobOptions {
  signal?: AbortSignal;
  /** Items recognized at once. Defaults to the engine pool size. */
  concurrency?: number;
  onItem?(outcome: ItemOutcome, progress: JobProgress): void;
}

export interface JobResult {
  /** In input order. After a cancel, only the items that finished. */
  outcomes: ItemOutcome[];
  cancelled: boolean;
}

export async function runOcrJob(
  items: readonly OcrWorkItem[],
  engine: OcrEngine,
  options: JobOptions = {},
): Promise<Result<JobResult>> {
  const { signal, onItem } = options;
  const concurrency = Math.max(1, options.concurrency ?? OCR_WORKER_POOL_SIZE);

  if (signal?.aborted) return ok({ outcomes: [], cancelled: true });
  if (items.length === 0) return ok({ outcomes: [], cancelled: false });

  // A download or WASM failure would otherwise surface as the same error on every item.
  let warm: Result<void>;
  try {
    warm = await engine.warmUp("ben");
  } catch (cause) {
    warm = err(AppErrors.unknown(START_FAILED, { debug: describe(cause) }));
  }
  if (!warm.ok) return err(warm.error);

  const slots: Array<ItemOutcome | undefined> = new Array(items.length);
  let next = 0;
  let completed = 0;
  let lastLoad: Promise<void> = Promise.resolve();

  /** Takes a place in line synchronously, so loads run one at a time in the order they were requested. */
  async function loadInOrder(item: OcrWorkItem): Promise<RawImage | null | typeof SKIPPED> {
    const myTurn = lastLoad;
    let done!: () => void;
    lastLoad = new Promise<void>((resolve) => (done = resolve));
    await myTurn;
    try {
      return signal?.aborted ? SKIPPED : await item.load();
    } finally {
      done();
    }
  }

  async function worker(): Promise<void> {
    while (!signal?.aborted && next < items.length) {
      const index = next++;
      const item = items[index];
      let outcome: ItemOutcome | typeof SKIPPED;
      try {
        outcome = await readItem(item, loadInOrder, engine);
      } catch (cause) {
        // Only an engine breaking its own Result contract gets here; one item fails, the job goes on.
        outcome = { status: "failed", id: item.id, error: AppErrors.unknown(ITEM_FAILED, { debug: describe(cause) }) };
      }
      if (outcome === SKIPPED) return;
      // A failure that lands after a cancel is almost always the cancel itself (the page disposed
      // the engine mid-pass), so the item counts as unfinished rather than failed.
      if (outcome.status === "failed" && signal?.aborted) return;
      slots[index] = outcome;
      completed++;
      try {
        onItem?.(outcome, { completed, total: items.length });
      } catch {
        // A UI callback bug must not abandon the other workers mid-job; the outcome is still returned.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));

  return ok({
    outcomes: slots.filter((outcome): outcome is ItemOutcome => outcome !== undefined),
    cancelled: signal?.aborted === true,
  });
}

const SKIPPED = Symbol("skipped");
const START_FAILED = "Text recognition could not start. Check your connection and try again.";
const ITEM_FAILED = "This image could not be read.";

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

async function readItem(
  item: OcrWorkItem,
  load: (item: OcrWorkItem) => Promise<RawImage | null | typeof SKIPPED>,
  engine: OcrEngine,
): Promise<ItemOutcome | typeof SKIPPED> {
  let image: RawImage | null | typeof SKIPPED;
  try {
    image = await load(item);
  } catch (cause) {
    return {
      status: "failed",
      id: item.id,
      error: AppErrors.fileProcessing("This image could not be extracted from the file.", {
        details: { reason: "extraction_failed" },
        debug: describe(cause),
      }),
    };
  }
  if (image === SKIPPED) return SKIPPED;
  if (image === null) return { status: "unreadable", id: item.id };

  const recognition = await recognizeBest(image, engine);
  if (!recognition.ok) return { status: "failed", id: item.id, error: recognition.error };

  const imagePixels = image.width * image.height;
  const text = normalizeOcrText(recognition.value.text);
  return {
    status: "done",
    id: item.id,
    text,
    confidence: recognition.value.confidence,
    lang: recognition.value.lang,
    words: recognition.value.words,
    fallback: assessFallback({ ...recognition.value, text }, imagePixels),
    imagePixels,
  };
}

/** Bengali pass, then an English-capable pass only when the first was poor; a failed second pass is not fatal. */
async function recognizeBest(image: RawImage, engine: OcrEngine): Promise<Result<OcrRecognition>> {
  const first = await engine.recognize(image, "ben");
  if (!first.ok || !needsEnglishRetry(first.value)) return first;
  const second = await engine.recognize(image, "ben+eng");
  return ok(second.ok ? pickBetterRecognition(first.value, second.value) : first.value);
}
