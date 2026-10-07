/**
 * The real worker factory: wraps `tesseract.js`, imported lazily so no page
 * that never reads an image downloads it. Everything with a decision in it
 * lives in `tesseract.ts`; this file is the thin adapter plus the one pure
 * helper that reshapes Tesseract's word tree.
 */
import type { OcrWord } from "../types";
import type { RecognizerWorker, WorkerFactory } from "./tesseract";

export interface TesseractLocation {
  /** URL of the worker script. Omit in Node, where tesseract.js finds its own. */
  workerPath?: string;
  /** Directory holding the `tesseract-core*-lstm.wasm.js` builds. Omit in Node. */
  corePath?: string;
  /** Directory holding `<lang>.traineddata.gz` — the integer-quantised `best_int` models. */
  langPath: string;
  /** `"none"` skips the browser's IndexedDB cache; the default keeps downloaded language data. */
  cacheMethod?: "write" | "readOnly" | "refresh" | "none";
}

/** Where `npm run ocr:sync` puts the files. */
export const BROWSER_TESSERACT_LOCATION: TesseractLocation = {
  workerPath: "/ocr/worker.min.js",
  corePath: "/ocr/core",
  langPath: "/ocr/lang",
};

type TesseractApi = Pick<typeof import("tesseract.js"), "createWorker" | "OEM">;

interface BlockLike {
  paragraphs: Array<{ lines: Array<{ words: Array<{ text: string; confidence: number }> }> }>;
}

/** Tesseract nests words under blocks → paragraphs → lines; the rules only need them in reading order. */
export function wordsFromBlocks(blocks: readonly BlockLike[] | null | undefined): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) words.push({ text: word.text, confidence: word.confidence });
      }
    }
  }
  return words;
}

export function createTesseractWorkerFactory(location: TesseractLocation): WorkerFactory {
  return async (lang): Promise<RecognizerWorker> => {
    // tesseract.js is CommonJS: depending on the bundler its exports sit on the namespace or on `default`.
    const namespace = (await import("tesseract.js")) as unknown as TesseractApi & { default?: TesseractApi };
    const { createWorker, OEM } =
      typeof namespace.createWorker === "function" ? namespace : (namespace.default ?? namespace);

    // When the core or language data fails to load, tesseract.js rethrows inside a message handler
    // (an uncaught error) and `createWorker` never settles — unless an `errorHandler` is given. So
    // a handler turns that into a rejection here. The half-started worker is unreachable and left
    // to be collected; the job is abandoned at this point anyway.
    let fail!: (reason: Error) => void;
    const failed = new Promise<never>((_, reject) => (fail = reject));
    failed.catch(() => undefined);
    const creating = createWorker(lang, OEM.LSTM_ONLY, {
      ...location,
      gzip: true,
      // Same-origin worker, so the page's CSP needs no `blob:` for it.
      workerBlobURL: false,
      errorHandler: (reason: unknown) => fail(new Error(String(reason))),
    });
    creating.catch(() => undefined);
    const worker = await Promise.race([creating, failed]);

    return {
      async recognize(image) {
        // tesseract.js types its image input as a Node `Buffer`, but both its builds accept any
        // `Uint8Array` of encoded image bytes (it re-wraps the bytes itself).
        const bytes = image as unknown as Parameters<typeof worker.recognize>[0];
        const { data } = await worker.recognize(bytes, {}, { text: true, blocks: true });
        return {
          text: data.text,
          confidence: data.confidence,
          words: wordsFromBlocks(data.blocks as BlockLike[] | null),
        };
      },
      async terminate() {
        await worker.terminate();
      },
    };
  };
}
