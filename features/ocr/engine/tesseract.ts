/**
 * The recognition engine: a small pool of Tesseract workers per language
 * behind an injected factory. Nothing here imports `tesseract.js` — the real
 * factory lives in `tesseractWorker.ts` and loads it lazily — so the pool's
 * concurrency, failure and shutdown rules are tested with fake workers.
 */
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import { OCR_WORKER_POOL_SIZE } from "../config";
import type { OcrLanguage, OcrRecognition, OcrWord, RawImage } from "../types";
import { encodeBmp } from "./bmp";

/** What the pool needs from one Tesseract worker. Takes encoded image bytes. */
export interface RecognizerWorker {
  recognize(image: Uint8Array): Promise<{ text: string; confidence: number; words: readonly OcrWord[] }>;
  terminate(): Promise<void>;
}

export type WorkerFactory = (lang: OcrLanguage) => Promise<RecognizerWorker>;

export interface OcrEngine {
  /** One pass over one image. Raw engine text — the caller normalizes it. */
  recognize(image: RawImage, lang: OcrLanguage): Promise<Result<OcrRecognition>>;
  /** Starts a worker for `lang` now, so a failed download or WASM load shows before any image is read. */
  warmUp(lang: OcrLanguage): Promise<Result<void>>;
  /** Terminates every worker. A disposed engine refuses new work. */
  dispose(): Promise<void>;
}

export interface EngineOptions {
  poolSize?: number;
}

interface Pool {
  idle: RecognizerWorker[];
  /** Workers started and not yet discarded, busy or idle. */
  live: number;
  waiters: Array<() => void>;
}

const START_FAILED = "Text recognition could not start. Check your connection and try again.";
const STOPPED = "Text recognition was stopped.";
const IMAGE_FAILED = "This image could not be read.";

export function createOcrEngine(factory: WorkerFactory, options: EngineOptions = {}): OcrEngine {
  const poolSize = Math.max(1, options.poolSize ?? OCR_WORKER_POOL_SIZE);
  const pools = new Map<OcrLanguage, Pool>();
  const tracked = new Set<RecognizerWorker>();
  let disposed = false;

  function poolFor(lang: OcrLanguage): Pool {
    let pool = pools.get(lang);
    if (!pool) {
      pool = { idle: [], live: 0, waiters: [] };
      pools.set(lang, pool);
    }
    return pool;
  }

  /** Wakes one waiter to re-check for an idle worker or a free slot. */
  function wake(pool: Pool): void {
    pool.waiters.shift()?.();
  }

  /** Throws only the `Error`s `guarded` turns into results. */
  async function acquire(lang: OcrLanguage): Promise<RecognizerWorker> {
    const pool = poolFor(lang);
    for (;;) {
      if (disposed) throw new StoppedError();
      const idle = pool.idle.pop();
      if (idle) return idle;
      if (pool.live < poolSize) {
        pool.live++;
        let worker: RecognizerWorker;
        try {
          worker = await factory(lang);
        } catch (cause) {
          pool.live--;
          wake(pool);
          throw new StartError(cause);
        }
        if (disposed) {
          pool.live--;
          await worker.terminate().catch(() => undefined);
          throw new StoppedError();
        }
        tracked.add(worker);
        return worker;
      }
      await new Promise<void>((resolve) => pool.waiters.push(resolve));
    }
  }

  function release(lang: OcrLanguage, worker: RecognizerWorker): void {
    const pool = poolFor(lang);
    if (disposed) return;
    pool.idle.push(worker);
    wake(pool);
  }

  /** A worker whose pass threw may be dead (WASM abort), so it is replaced rather than reused. */
  async function discard(lang: OcrLanguage, worker: RecognizerWorker): Promise<void> {
    const pool = poolFor(lang);
    tracked.delete(worker);
    pool.live--;
    wake(pool);
    await worker.terminate().catch(() => undefined);
  }

  return {
    async recognize(image, lang) {
      let worker: RecognizerWorker;
      try {
        worker = await acquire(lang);
      } catch (cause) {
        return err(acquireError(cause));
      }
      try {
        const pass = await worker.recognize(encodeBmp(image));
        release(lang, worker);
        return ok({ text: pass.text, confidence: pass.confidence, lang, words: pass.words });
      } catch (cause) {
        await discard(lang, worker);
        return err(
          disposed ? AppErrors.unknown(STOPPED) : AppErrors.unknown(IMAGE_FAILED, { debug: describe(cause) }),
        );
      }
    },

    async warmUp(lang) {
      let worker: RecognizerWorker;
      try {
        worker = await acquire(lang);
      } catch (cause) {
        return err(acquireError(cause));
      }
      release(lang, worker);
      return ok(undefined);
    },

    async dispose() {
      disposed = true;
      for (const pool of pools.values()) {
        pool.idle = [];
        pool.waiters.splice(0).forEach((resolve) => resolve());
      }
      const workers = [...tracked];
      tracked.clear();
      await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)));
    },
  };
}

class StartError extends Error {
  constructor(readonly original: unknown) {
    super("worker failed to start");
  }
}

class StoppedError extends Error {}

function acquireError(cause: unknown) {
  if (cause instanceof StartError) return AppErrors.unknown(START_FAILED, { debug: describe(cause.original) });
  return AppErrors.unknown(STOPPED);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}
