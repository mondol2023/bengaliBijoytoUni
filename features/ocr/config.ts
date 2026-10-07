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

// ── Whole-page rendering ───────────────────────────────────────────────────

/** 2× was as accurate as 3× in the spike (≈1% CER) at a fraction of the memory. */
export const OCR_PAGE_RENDER_SCALE = 2;
/** Pixel budget for one rendered page; an oversize page is scaled down to fit. */
export const OCR_MAX_PAGE_PIXELS = 4_000_000;

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
