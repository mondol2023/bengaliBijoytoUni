import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import { MAX_UPLOAD_SIZE_BYTES } from "@/features/documents/config";

/**
 * Every number the OCR feature tunes on lives here. Those marked
 * *provisional* come from the Phase 0 spike (`docs/ocr-extraction-plan.md`
 * §11), which had only two hard real-world samples — revisit them when more
 * data exists rather than treating them as measured.
 */

// ── Hard caps: exceeding one returns a user-safe error, never a hang ──────

/** Same 15MB ceiling as `/documents`. */
export const OCR_MAX_FILE_BYTES = MAX_UPLOAD_SIZE_BYTES;
/** Most items (stitched rows / images) read in one job. A court page is ~15–20 rows. */
export const OCR_MAX_ITEMS = 300;
/** Most PDF pages read in one job, in either mode. */
export const OCR_MAX_PAGES = 30;
/** Largest single embedded image decoded, in pixels (~4000 × 4000). */
export const OCR_MAX_ITEM_PIXELS = 16_000_000;

// ── Engine ─────────────────────────────────────────────────────────────────

/** Tesseract workers alive per language. Each holds a WASM instance plus the language data, so two is the memory/latency compromise. */
export const OCR_WORKER_POOL_SIZE = 2;
/**
 * Longest a worker may take to start: the first use downloads ~6 MB (WASM core
 * plus `ben` data), which is ~50 s on a slow 1 Mbps link. *Provisional.*
 */
export const OCR_WORKER_START_TIMEOUT_MS = 120_000;
/**
 * Longest one pass over one image may take before its worker is presumed dead
 * (tesseract.js never settles a job whose worker crashed). A 2× page is a few
 * seconds on a laptop; this leaves room for a slow phone. *Provisional.*
 */
export const OCR_RECOGNIZE_TIMEOUT_MS = 90_000;
/** Consecutive start failures for one language before it is given up on for the rest of the job. */
export const OCR_WORKER_START_ATTEMPTS = 2;

// ── Whole-page rendering ───────────────────────────────────────────────────

/** 2× was as accurate as 3× in the spike (≈1% CER) at a fraction of the memory. */
export const OCR_PAGE_RENDER_SCALE = 2;
/** Pixel budget for one rendered page; an oversize page is scaled down to fit. */
export const OCR_MAX_PAGE_PIXELS = 4_000_000;

// ── pdf.js hosting and previews ────────────────────────────────────────────

/** The self-hosted pdf.js worker (copied by `npm run ocr:sync`). */
export const OCR_PDF_WORKER_SRC = "/ocr/pdf.worker.min.mjs";
/**
 * `getDocument` options pointing pdf.js at the self-hosted decoders (WASM for JBIG2/JPEG 2000/ICC)
 * and fonts/CMaps for non-embedded fonts. All read by pdfjs-dist 6.4.299; all copied by `ocr:sync`.
 */
export const OCR_PDF_DOCUMENT_OPTIONS: Readonly<Record<string, unknown>> = {
  wasmUrl: "/ocr/pdfjs/wasm/",
  cMapUrl: "/ocr/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/ocr/pdfjs/standard_fonts/",
  iccUrl: "/ocr/pdfjs/iccs/",
};
/** Longest edge of a row/page preview — readable when enlarged, and (squared) within the page pixel cap. */
export const OCR_PREVIEW_MAX_EDGE_PX = 1600;
/** Longest edge of the scanner-bed page render. */
export const OCR_BED_PAGE_MAX_EDGE_PX = 900;

// ── Filtering embedded images ──────────────────────────────────────────────

/** An image with a side under this is an icon or rule, not text. */
export const OCR_MIN_SIDE_PX = 48;
/** …and so is one under this area, even when both sides pass. */
export const OCR_MIN_AREA_PX = 3_000;
/** Fragments whose tops are within this many points belong to the same text line. */
export const OCR_ROW_TOLERANCE_PT = 6;
/** The same pixels within this many points of an earlier copy are a repeated logo/header. */
export const OCR_SAME_POSITION_TOLERANCE_PT = 3;
/**
 * A stitched row smaller than this (≈ one 138 px line-height × 87 px) holds no
 * real word — the spike's lone-hyphen strip OCR'd to `জ্্্` at confidence 22.
 * *Provisional*: calibrate against real stitched rows in Phase 2.
 */
export const OCR_MIN_ROW_AREA_PX = 12_000;

// ── Engine decisions (see `engine/confidence.ts`) ──────────────────────────

/** Below this mean confidence, a result goes to the fallback. Good samples were ≥ 88, the licence photo 76. *Provisional.* */
export const OCR_FALLBACK_CONFIDENCE = 82;
/** A `ben`-only pass below this is re-run with `ben+eng` (the English page scored 38). */
export const OCR_ENGLISH_RETRY_CONFIDENCE = 60;
/** Empty output only counts as a miss on an image at least this big (≈ 100 × 100). */
export const OCR_NONTRIVIAL_IMAGE_PIXELS = 10_000;

/** Scale for rendering a `width × height` pt page: 2×, reduced if that would pass the pixel cap. */
export function pageRenderScale(widthPt: number, heightPt: number): number {
  const area = widthPt * heightPt;
  if (!(area > 0)) return OCR_PAGE_RENDER_SCALE;
  return Math.min(OCR_PAGE_RENDER_SCALE, Math.sqrt(OCR_MAX_PAGE_PIXELS / area));
}

export function checkPageCap(pageCount: number): Result<number> {
  if (pageCount < 1) {
    return err(
      AppErrors.fileProcessing("This file has no pages to read.", { details: { reason: "empty" } }),
    );
  }
  if (pageCount > OCR_MAX_PAGES) {
    return err(
      AppErrors.fileProcessing(
        `This file has ${pageCount} pages — text recognition reads up to ${OCR_MAX_PAGES} pages at a time. Split the file and try again.`,
        { details: { reason: "too_large" } },
      ),
    );
  }
  return ok(pageCount);
}

export function checkItemCap(itemCount: number): Result<number> {
  if (itemCount > OCR_MAX_ITEMS) {
    return err(
      AppErrors.fileProcessing(
        `This file has ${itemCount} images to read — the limit is ${OCR_MAX_ITEMS} at a time. Try Whole pages mode, or split the file.`,
        { details: { reason: "too_large" } },
      ),
    );
  }
  return ok(itemCount);
}
