/**
 * Shared shapes for the `/ocr` feature. Types only — no behavior — so every
 * module (extract, engine, UI) can agree on them without importing each other.
 */

/** Which pixels get read: images embedded in the file, or every PDF page rendered whole. */
export type OcrMode = "embedded" | "pages";

/** What the filters need to know about an image, without holding its pixels. */
export interface ImageInfo {
  pxWidth: number;
  pxHeight: number;
  /** Content hash of the decoded pixels, used to spot the same image twice. */
  hash: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An image as drawn on a PDF page. Coordinates are in PDF points with the
 * origin at the **top-left** (y grows downward), so "reading order" is plain
 * ascending y then x — the extractor flips pdfjs's bottom-left origin.
 */
export interface PlacedImage extends ImageInfo, Box {
  /** 1-based page number. */
  page: number;
}

/** Same-line fragments of one page, left to right, ready to be stitched into a single image. */
export interface ImageRow<T extends PlacedImage = PlacedImage> {
  page: number;
  /** Union of the fragments' boxes. */
  box: Box;
  fragments: T[];
}

export type OcrLanguage = "ben" | "ben+eng";

export interface OcrWord {
  text: string;
  /** 0..100, as Tesseract reports it. */
  confidence: number;
}

/** One engine pass over one image. */
export interface OcrRecognition {
  text: string;
  /** Mean confidence, 0..100. */
  confidence: number;
  lang: OcrLanguage;
  words: readonly OcrWord[];
}

export type FallbackReason = "low-confidence" | "empty-output";

export type FallbackDecision = { needed: false } | { needed: true; reason: FallbackReason };

/** 2D affine matrix `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

/** Decoded pixels, always 8-bit RGBA, row-major, top row first. */
export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * An image found by scanning a PDF page — its placement and size only. The
 * pixels are dropped after hashing (a scanned page decodes to ~15 MB) and
 * re-fetched by `opIndex` for just the rows that survive filtering.
 */
export interface ScannedPdfImage extends PlacedImage {
  /** Index of the paint operator in the page's operator list. */
  opIndex: number;
  /**
   * Maps the image's unit square (image top edge at v = 1, as in PDF) to this
   * page's top-left-origin points. Carries any flip or rotation.
   */
  transform: Matrix;
}
