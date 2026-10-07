/**
 * Decides which embedded images are worth reading, and in what order — from
 * their sizes and placements alone, so it runs (and is tested) without any
 * pixels. The extractors (Phase 2) feed it; it never decodes anything.
 *
 * Two inputs, two plans:
 * - **PDF** images have a page position. Court PDFs draw each text line as
 *   3–10 overlapping fragments, so the plan groups same-line fragments into
 *   rows for the extractor to stitch before OCR (stitched lines scored 0–1%
 *   CER; lone fragments are unreadable).
 * - **DOCX** images have no position, only document order, so the plan just
 *   filters and de-duplicates them.
 */
import {
  OCR_MIN_AREA_PX,
  OCR_MIN_ROW_AREA_PX,
  OCR_MIN_SIDE_PX,
  OCR_ROW_TOLERANCE_PT,
  OCR_SAME_POSITION_TOLERANCE_PT,
  checkItemCap,
} from "../config";
import type { ImageInfo, ImageRow, PlacedImage } from "../types";
import { err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";

export interface EmbeddedPlan<T extends PlacedImage> {
  rows: ImageRow<T>[];
  skipped: { decorative: number; duplicate: number; tinyRow: number };
}

export interface UnplacedPlan<T extends ImageInfo> {
  items: T[];
  skipped: { decorative: number; duplicate: number };
}

/** An icon, bullet or rule: too small on a side or in area to hold readable text. */
export function isDecorative(image: ImageInfo): boolean {
  return (
    Math.min(image.pxWidth, image.pxHeight) < OCR_MIN_SIDE_PX ||
    image.pxWidth * image.pxHeight < OCR_MIN_AREA_PX
  );
}

/** Keeps the first image of each content hash, in input order. */
export function dedupeByHash<T extends { hash: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    if (seen.has(item.hash)) continue;
    seen.add(item.hash);
    kept.push(item);
  }
  return kept;
}

/**
 * Drops an image whose pixels were already drawn at the same spot — a logo or
 * letterhead repeated on every page. Identical pixels at a *different* spot
 * are kept: the same glyph strip can genuinely recur within a text line, so a
 * hash alone would delete real text.
 */
export function dedupeRepeatedPlacements<T extends PlacedImage>(items: readonly T[]): T[] {
  const keptByHash = new Map<string, T[]>();
  const kept: T[] = [];
  for (const item of items) {
    const earlier = keptByHash.get(item.hash) ?? [];
    const repeated = earlier.some(
      (other) =>
        Math.abs(other.x - item.x) <= OCR_SAME_POSITION_TOLERANCE_PT &&
        Math.abs(other.y - item.y) <= OCR_SAME_POSITION_TOLERANCE_PT,
    );
    if (repeated) continue;
    earlier.push(item);
    keptByHash.set(item.hash, earlier);
    kept.push(item);
  }
  return kept;
}

/**
 * Groups same-line fragments into rows: reading order is page, then top to
 * bottom, then left to right. A fragment joins a row when its top is within
 * the tolerance of the **row's first** fragment, not of the previous one, so a
 * run of small steps cannot drift a row down the page.
 */
export function groupIntoRows<T extends PlacedImage>(items: readonly T[]): ImageRow<T>[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);

  const groups: T[][] = [];
  for (const item of sorted) {
    const group = groups[groups.length - 1];
    const head = group?.[0];
    if (head && head.page === item.page && item.y - head.y <= OCR_ROW_TOLERANCE_PT) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map((group) => {
    const fragments = [...group].sort((a, b) => a.x - b.x);
    const left = Math.min(...fragments.map((f) => f.x));
    const top = Math.min(...fragments.map((f) => f.y));
    const right = Math.max(...fragments.map((f) => f.x + f.width));
    const bottom = Math.max(...fragments.map((f) => f.y + f.height));
    return {
      page: fragments[0].page,
      box: { x: left, y: top, width: right - left, height: bottom - top },
      fragments,
    };
  });
}

/** Pixel area of the stitched row, from the box and the fragments' px-per-point density. */
function rowPixelArea(row: ImageRow): number {
  const pxPerPtX = Math.max(...row.fragments.map((f) => f.pxWidth / f.width));
  const pxPerPtY = Math.max(...row.fragments.map((f) => f.pxHeight / f.height));
  return row.box.width * pxPerPtX * (row.box.height * pxPerPtY);
}

/**
 * PDF embedded-images plan: drop icons and zero-area draws, drop logos
 * repeated at the same spot, group into rows, drop rows too small to hold a
 * word, then enforce the item cap.
 */
export function planEmbeddedRows<T extends PlacedImage>(images: readonly T[]): Result<EmbeddedPlan<T>> {
  const sized = images.filter((image) => image.width > 0 && image.height > 0 && !isDecorative(image));
  const unique = dedupeRepeatedPlacements(sized);
  const allRows = groupIntoRows(unique);
  const rows = allRows.filter((row) => rowPixelArea(row) >= OCR_MIN_ROW_AREA_PX);

  const capped = checkItemCap(rows.length);
  if (!capped.ok) return err(capped.error);

  return ok({
    rows,
    skipped: {
      decorative: images.length - sized.length,
      duplicate: sized.length - unique.length,
      tinyRow: allRows.length - rows.length,
    },
  });
}

/** DOCX plan: images arrive in document order; drop icons and byte-identical repeats, then enforce the item cap. */
export function planUnplacedImages<T extends ImageInfo>(images: readonly T[]): Result<UnplacedPlan<T>> {
  const sized = images.filter((image) => !isDecorative(image));
  const items = dedupeByHash(sized);

  const capped = checkItemCap(items.length);
  if (!capped.ok) return err(capped.error);

  return ok({
    items,
    skipped: { decorative: images.length - sized.length, duplicate: sized.length - items.length },
  });
}
