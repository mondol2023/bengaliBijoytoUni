/**
 * Finds the images a PDF draws, and later re-reads the ones worth OCR'ing.
 *
 * Two stages, because pixels are expensive and most images are not wanted:
 * - `scanPdfImages` walks each page's operator list tracking the transform
 *   matrix, and records every image's placement, pixel size and a content
 *   hash — then drops the pixels. A scanned page decodes to ~15 MB; a 30-page
 *   court PDF would otherwise be held in memory whole.
 * - After `planEmbeddedRows` (filter.ts) picks the rows to read, a
 *   `createRowRenderer` re-fetches only those fragments, one row at a time,
 *   and stitches them into the single image Tesseract reads.
 *
 * Masks (`paintImageMaskXObject`) and the grouped/repeated paint operators are
 * not read; they are counted in `unreadable` so the UI can say so.
 */
import type { PDFPageProxy } from "pdfjs-dist";
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import { OCR_MAX_ITEM_PIXELS } from "../config";
import type { ImageRow, Matrix, RawImage, ScannedPdfImage } from "../types";
import type { CanvasEnv } from "./canvas";
import type { OpenPdf } from "./openPdf";
import { bitmapToRgba, hashBytes, pixelBufferLength, stitchRow, toRgba } from "./pixels";

export interface PdfScan {
  images: ScannedPdfImage[];
  pageCount: number;
  /** Image paints that could not be read: masks, repeats, oversize, malformed. */
  unreadable: number;
}

export interface ScanOptions {
  /** Checked between pages. An abort returns an `UNKNOWN_ERROR` carrying `debug: { cancelled: true }`. */
  signal?: AbortSignal;
  onPage?: (page: number, total: number) => void;
  /** Lets a browser `ImageBitmap` (pdf.js's JPEG path) be read back. Without it, such images are unreadable. */
  env?: Pick<CanvasEnv, "createCanvas">;
}

/** The fields of a pdf.js image object this module reads. */
interface PdfImageObject {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  /** An `ImageBitmap`, or a `VideoFrame` in current Chromium; neither is read for its own size. */
  bitmap?: object;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `first` applied before `second` (row-vector convention, as PDF writes it). */
function multiply(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

function asMatrix(value: unknown): Matrix | null {
  return Array.isArray(value) && value.length === 6 && value.every((n) => typeof n === "number")
    ? (value as unknown as Matrix)
    : null;
}

/** How long to wait for pdf.js to finish decoding one image before treating it as unreadable. */
const IMAGE_WAIT_MS = 10_000;

/**
 * The image object a paint operator refers to: a named XObject, or inline
 * data. pdf.js decodes named images asynchronously, and `getOperatorList()`
 * can resolve before they are ready (`objs.get` then throws), so wait on the
 * callback form — with a timeout, since an image that fails to decode may
 * never resolve.
 */
async function resolveImageObject(page: PDFPageProxy, args: unknown[] | undefined): Promise<PdfImageObject | null> {
  const first = args?.[0];
  if (typeof first !== "string") return first && typeof first === "object" ? (first as PdfImageObject) : null;

  // pdf.js keeps ids starting "g_" (shared across pages) in the document-wide store.
  const store = first.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), IMAGE_WAIT_MS);
    store.get(first, (value: unknown) => {
      clearTimeout(timer);
      resolve(value && typeof value === "object" ? (value as PdfImageObject) : null);
    });
  });
}

/** Whether an image object is something this module can read and is not oversize. */
function isReadable(image: PdfImageObject): boolean {
  if (!(image.width > 0 && image.height > 0) || image.width * image.height > OCR_MAX_ITEM_PIXELS) return false;
  if (image.data) {
    const needed = pixelBufferLength(image.kind ?? 0, image.width, image.height);
    return needed !== null && image.data.length >= needed;
  }
  return Boolean(image.bitmap);
}

function imageToRgba(image: PdfImageObject, env: ScanOptions["env"]): RawImage | null {
  if (!isReadable(image)) return null;
  if (image.data) return toRgba({ width: image.width, height: image.height, kind: image.kind ?? 0, data: image.data });
  return image.bitmap && env ? bitmapToRgba(image.bitmap, env, image) : null;
}

function extractionFailed(cause: unknown): Result<never> {
  return err(
    AppErrors.fileProcessing("Could not read the images in this PDF — it may be corrupted.", {
      details: { fileType: "pdf", reason: "extraction_failed" },
      debug: cause,
    }),
  );
}

async function scanPage(
  page: PDFPageProxy,
  pageNumber: number,
  ops: OpenPdf["ops"],
  env: ScanOptions["env"],
): Promise<{ images: ScannedPdfImage[]; unreadable: number }> {
  const view = page.getViewport({ scale: 1 }).transform as unknown as Matrix;
  const list = await page.getOperatorList();

  const images: ScannedPdfImage[] = [];
  let unreadable = 0;
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[] | undefined;

    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.transform) {
      const m = asMatrix(args);
      if (m) ctm = multiply(m, ctm);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = asMatrix(args?.[0]);
      if (m) ctm = multiply(m, ctm);
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
      const object = await resolveImageObject(page, args);
      const readable = object && isReadable(object) ? object : null;
      if (!readable) {
        unreadable++;
        continue;
      }

      let hash: string;
      if (readable.data) {
        hash = hashBytes(readable.data, `${readable.width}x${readable.height}:${readable.kind}`);
      } else {
        const converted = imageToRgba(readable, env);
        if (!converted) {
          unreadable++;
          continue;
        }
        hash = hashBytes(converted.data, `${converted.width}x${converted.height}:rgba`);
      }

      const device = multiply(ctm, view);
      const [a, b, c, d, e, f] = device;
      const xs = [e, a + e, c + e, a + c + e];
      const ys = [f, b + f, d + f, b + d + f];
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      images.push({
        page: pageNumber,
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
        pxWidth: readable.width,
        pxHeight: readable.height,
        hash,
        opIndex: i,
        transform: device,
      });
    } else if (
      fn === ops.paintImageMaskXObject ||
      fn === ops.paintImageMaskXObjectGroup ||
      fn === ops.paintImageMaskXObjectRepeat ||
      fn === ops.paintImageXObjectRepeat ||
      fn === ops.paintInlineImageXObjectGroup
    ) {
      unreadable++;
    }
  }

  return { images, unreadable };
}

/** Records every image the PDF draws — placement, pixel size, content hash — without keeping pixels. */
export async function scanPdfImages(pdf: OpenPdf, options: ScanOptions = {}): Promise<Result<PdfScan>> {
  const { doc, ops } = pdf;
  const images: ScannedPdfImage[] = [];
  let unreadable = 0;

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (options.signal?.aborted) {
        return err(AppErrors.unknown("The job was cancelled.", { debug: { cancelled: true } }));
      }
      const page = await doc.getPage(pageNumber);
      try {
        const found = await scanPage(page, pageNumber, ops, options.env);
        images.push(...found.images);
        unreadable += found.unreadable;
      } finally {
        page.cleanup();
      }
      options.onPage?.(pageNumber, doc.numPages);
    }
  } catch (cause) {
    return extractionFailed(cause);
  }

  return ok({ images, pageCount: doc.numPages, unreadable });
}

export interface RowRenderer {
  /** Stitches the row's fragments into one image. Rows on the same page are cheapest; moving pages releases the last one. */
  render(row: ImageRow<ScannedPdfImage>): Promise<Result<RawImage>>;
  dispose(): void;
}

export function createRowRenderer(pdf: OpenPdf, options: Pick<ScanOptions, "env"> = {}): RowRenderer {
  let current: { pageNumber: number; page: PDFPageProxy; argsArray: unknown[][] } | null = null;

  function release() {
    current?.page.cleanup();
    current = null;
  }

  async function load(pageNumber: number) {
    if (current?.pageNumber === pageNumber) return current;
    release();
    const page = await pdf.doc.getPage(pageNumber);
    const list = await page.getOperatorList();
    current = { pageNumber, page, argsArray: list.argsArray as unknown[][] };
    return current;
  }

  return {
    async render(row) {
      try {
        const loaded = await load(row.page);
        const pixels = new Map<number, RawImage>();
        for (const fragment of row.fragments) {
          const object = await resolveImageObject(loaded.page, loaded.argsArray[fragment.opIndex]);
          const rgba = object ? imageToRgba(object, options.env) : null;
          if (!rgba) {
            return err(
              AppErrors.fileProcessing(`Could not read an image on page ${row.page}.`, {
                details: { fileType: "pdf", reason: "extraction_failed" },
              }),
            );
          }
          pixels.set(fragment.opIndex, rgba);
        }
        return ok(stitchRow(row, (fragment) => pixels.get(fragment.opIndex)!));
      } catch (cause) {
        return extractionFailed(cause);
      }
    },
    dispose: release,
  };
}
