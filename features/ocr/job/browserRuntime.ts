/**
 * The browser-only half of an OCR job: the real Tesseract engine, the DOM
 * canvas, the self-hosted pdf.js settings and the preview encoder. Reached
 * only through `import()` from `useOcrJob`, so pdf.js, JSZip and tesseract.js
 * stay out of every eager bundle until the user starts a job.
 */
import { OCR_PDF_DOCUMENT_OPTIONS, OCR_PDF_WORKER_SRC } from "../config";
import { createOcrEngine } from "../engine/tesseract";
import type { OcrEngine } from "../engine/tesseract";
import { BROWSER_TESSERACT_LOCATION, createTesseractWorkerFactory } from "../engine/tesseractWorker";
import type { CanvasEnv } from "../extract/canvas";
import { browserCanvasEnv } from "../extract/browserCanvas";
import type { OpenPdfOptions } from "../extract/openPdf";
import type { RawImage } from "../types";
import { prepareOcrSource } from "./source";

export interface BrowserOcrRuntime {
  createEngine(): OcrEngine;
  canvas: CanvasEnv;
  pdf: OpenPdfOptions;
  /** Downscales to `maxEdge` if larger, encodes JPEG (q 0.85) and returns an object URL the caller must revoke. */
  toPreviewUrl(image: RawImage, maxEdge: number): Promise<string>;
  /** Re-exported so pdf.js and JSZip stay in this lazy chunk. */
  prepare: typeof prepareOcrSource;
}

const PREVIEW_JPEG_QUALITY = 0.85;

async function toPreviewUrl(image: RawImage, maxEdge: number): Promise<string> {
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("no 2D canvas context");
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);

  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  let target = source;
  if (scale < 1) {
    target = document.createElement("canvas");
    target.width = width;
    target.height = height;
    const context = target.getContext("2d");
    if (!context) throw new Error("no 2D canvas context");
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
  }

  const blob = await new Promise<Blob | null>((resolve) => target.toBlob(resolve, "image/jpeg", PREVIEW_JPEG_QUALITY));
  if (!blob) throw new Error("preview encoding failed");
  return URL.createObjectURL(blob);
}

export const browserOcrRuntime: BrowserOcrRuntime = {
  createEngine: () => createOcrEngine(createTesseractWorkerFactory(BROWSER_TESSERACT_LOCATION)),
  canvas: browserCanvasEnv,
  pdf: { workerSrc: OCR_PDF_WORKER_SRC, documentOptions: { ...OCR_PDF_DOCUMENT_OPTIONS } },
  toPreviewUrl,
  prepare: prepareOcrSource,
};
