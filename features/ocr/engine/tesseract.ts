/**
 * The recognition engine: a small pool of Tesseract workers per language
 * behind an injected factory. Nothing here imports `tesseract.js` — the real
 * factory lives in `tesseractWorker.ts` and loads it lazily — so the pool's
 * concurrency, failure and shutdown rules are tested with fake workers.
 *
 * Nothing the engine awaits may hang. tesseract.js never settles a job whose
 * worker was terminated or crashed (a WASM abort, an OOM kill), and never
 * settles a start that stalls on a download, so every start and every pass is
 * raced against a timeout and against `dispose()`.
 */
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import {
  OCR_MAX_ITEM_PIXELS,
  OCR_RECOGNIZE_TIMEOUT_MS,
  OCR_WORKER_POOL_SIZE,
  OCR_WORKER_START_ATTEMPTS,
  OCR_WORKER_START_TIMEOUT_MS,
} from "../config";
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
  /** Terminates every worker and settles every pending call. A disposed engine refuses new work. */
  dispose(): Promise<void>;
}

export interface EngineOptions {
  poolSize?: number;
  startTimeoutMs?: number;
  recognizeTimeoutMs?: number;
  /** Consecutive start failures for a language before it fails fast for the engine's lifetime. */
  maxStartAttempts?: number;
}

interface Pool {
  idle: RecognizerWorker[];
  /** Workers started and not yet discarded, busy or idle. */
  live: number;
  waiters: Array<() => void>;
  /** Consecutive start failures; reset by a successful start. */
  startFailures: number;
  lastStartFailure?: unknown;
}

/** How an awaited start or pass ended. */
type Settled<T> =
  | { kind: "value"; value: T }
  | { kind: "error"; cause: unknown }
  | { kind: "timeout" }
  | { kind: "stopped" };

const START_FAILED = "Text recognition could not start. Check your connection and try again.";
const STOPPED = "Text recognition was stopped.";
const IMAGE_FAILED = "This image could not be read.";
const IMAGE_TIMED_OUT = "This image took too long to read.";

export function createOcrEngine(factory: WorkerFactory, options: EngineOptions = {}): OcrEngine {
  const poolSize = Math.max(1, options.poolSize ?? OCR_WORKER_POOL_SIZE);
  const startTimeoutMs = options.startTimeoutMs ?? OCR_WORKER_START_TIMEOUT_MS;
  const recognizeTimeoutMs = options.recognizeTimeoutMs ?? OCR_RECOGNIZE_TIMEOUT_MS;
  const maxStartAttempts = Math.max(1, options.maxStartAttempts ?? OCR_WORKER_START_ATTEMPTS);
  const pools = new Map<OcrLanguage, Pool>();
  const tracked = new Set<RecognizerWorker>();
  /** Ends every in-flight `settle` with "stopped" when the engine is disposed. */
  const stopHooks = new Set<() => void>();
  let disposed = false;

  function poolFor(lang: OcrLanguage): Pool {
    let pool = pools.get(lang);
    if (!pool) {
      pool = { idle: [], live: 0, waiters: [], startFailures: 0 };
      pools.set(lang, pool);
    }
    return pool;
  }

  /** Waits for `work`, but no longer than `timeoutMs` and no longer than the engine lives. Never rejects. */
  function settle<T>(work: Promise<T>, timeoutMs: number): Promise<Settled<T>> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (outcome: Settled<T>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stopHooks.delete(stop);
        resolve(outcome);
      };
      const stop = () => finish({ kind: "stopped" });
      const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
      stopHooks.add(stop);
      work.then(
        (value) => finish({ kind: "value", value }),
        (cause) => finish({ kind: "error", cause }),
      );
      if (disposed) stop();
    });
  }

  /** Wakes one waiter to re-check for an idle worker or a free slot. */
  function wake(pool: Pool): void {
    pool.waiters.shift()?.();
  }

  /** Throws only the `Error`s `acquireError` turns into results. */
  async function acquire(lang: OcrLanguage): Promise<RecognizerWorker> {
    const pool = poolFor(lang);
    for (;;) {
      if (disposed) throw new StoppedError();
      const idle = pool.idle.pop();
      if (idle) return idle;
      // After repeated start failures, don't make every remaining item wait out another start
      // timeout (and leave another half-started worker behind) — use live workers or fail fast.
      const canStart = pool.startFailures < maxStartAttempts;
      if (!canStart && pool.live === 0) throw new StartError(pool.lastStartFailure);
      if (canStart && pool.live < poolSize) {
        pool.live++;
        const starting = Promise.resolve().then(() => factory(lang));
        const started = await settle(starting, startTimeoutMs);
        if (started.kind === "value" && !disposed) {
          pool.startFailures = 0;
          tracked.add(started.value);
          return started.value;
        }
        pool.live--;
        wake(pool);
        if (started.kind !== "error") {
          // Gave up waiting (or was disposed): if the worker turns up after all, don't leak it.
          starting.then((worker) => worker.terminate().catch(() => undefined), () => undefined);
        }
        if (started.kind === "value" || started.kind === "stopped") throw new StoppedError();
        const cause =
          started.kind === "timeout" ? new Error(`worker start timed out after ${startTimeoutMs} ms`) : started.cause;
        pool.startFailures++;
        pool.lastStartFailure = cause;
        throw new StartError(cause);
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

  /** A worker whose pass threw, hung or was cut off may be dead or still busy, so it is replaced rather than reused. */
  async function discard(lang: OcrLanguage, worker: RecognizerWorker): Promise<void> {
    const pool = poolFor(lang);
    tracked.delete(worker);
    pool.live--;
    wake(pool);
    await Promise.resolve()
      .then(() => worker.terminate())
      .catch(() => undefined);
  }

  return {
    async recognize(image, lang) {
      // Checked before a worker is involved: a short buffer would be read past its end, and a
      // zero-sized or huge image can abort the WASM core, costing a worker for nothing.
      const problem = imageProblem(image);
      if (problem) return err(AppErrors.unknown(IMAGE_FAILED, { debug: problem }));
      let bytes: Uint8Array;
      try {
        bytes = encodeBmp(image);
      } catch (cause) {
        return err(AppErrors.unknown(IMAGE_FAILED, { debug: describe(cause) }));
      }

      let worker: RecognizerWorker;
      try {
        worker = await acquire(lang);
      } catch (cause) {
        return err(acquireError(cause));
      }
      const pass = await settle(
        Promise.resolve().then(() => worker.recognize(bytes)),
        recognizeTimeoutMs,
      );
      if (pass.kind === "value") {
        release(lang, worker);
        return ok(sanitizePass(pass.value, lang));
      }
      await discard(lang, worker);
      if (pass.kind === "stopped" || disposed) return err(AppErrors.unknown(STOPPED));
      if (pass.kind === "timeout") {
        return err(
          AppErrors.unknown(IMAGE_TIMED_OUT, { debug: `recognition timed out after ${recognizeTimeoutMs} ms` }),
        );
      }
      return err(AppErrors.unknown(IMAGE_FAILED, { debug: describe(pass.cause) }));
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
      [...stopHooks].forEach((stop) => stop());
      for (const pool of pools.values()) {
        pool.idle = [];
        pool.waiters.splice(0).forEach((resolve) => resolve());
      }
      const workers = [...tracked];
      tracked.clear();
      await Promise.all(
        workers.map((worker) =>
          Promise.resolve()
            .then(() => worker.terminate())
            .catch(() => undefined),
        ),
      );
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

function imageProblem({ width, height, data }: RawImage): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return `invalid image size ${width}x${height}`;
  }
  if (width * height > OCR_MAX_ITEM_PIXELS) {
    return `${width}x${height} is over the ${OCR_MAX_ITEM_PIXELS}-pixel cap`;
  }
  const expected = width * height * 4;
  if (data?.length !== expected) return `pixel buffer holds ${data?.length} bytes, expected ${expected}`;
  return null;
}

/** The rules downstream assume a string and 0..100; a worker's output is not trusted to provide them. */
function sanitizePass(
  pass: { text?: unknown; confidence?: unknown; words?: unknown } | null | undefined,
  lang: OcrLanguage,
): OcrRecognition {
  const words: OcrWord[] = [];
  for (const word of Array.isArray(pass?.words) ? (pass.words as unknown[]) : []) {
    if (word && typeof word === "object" && typeof (word as OcrWord).text === "string") {
      words.push({ text: (word as OcrWord).text, confidence: clampConfidence((word as OcrWord).confidence) });
    }
  }
  return {
    text: typeof pass?.text === "string" ? pass.text : "",
    confidence: clampConfidence(pass?.confidence),
    lang,
    words,
  };
}

function clampConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}
