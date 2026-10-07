/**
 * Pixel-level helpers: pdf.js image objects to RGBA, content hashing, and
 * stitching a row of same-line fragments into one image. Pure — works on
 * plain typed arrays, no canvas — so it runs in the browser and in vitest.
 */
import { OCR_MAX_ITEM_PIXELS } from "../config";
import type { ImageRow, RawImage, ScannedPdfImage } from "../types";
import type { CanvasEnv } from "./canvas";

/** pdf.js `ImageKind`. */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

/** Bytes a pdf.js buffer of this kind must hold for `width × height`, or null for an unknown kind. */
export function pixelBufferLength(kind: number, width: number, height: number): number | null {
  if (kind === RGBA_32BPP) return width * height * 4;
  if (kind === RGB_24BPP) return width * height * 3;
  if (kind === GRAYSCALE_1BPP) return Math.ceil(width / 8) * height;
  return null;
}

/** Converts a pdf.js image buffer to RGBA, or null when it is malformed or an unknown kind. */
export function toRgba(source: {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
}): RawImage | null {
  const { width, height, kind, data } = source;
  const pixels = width * height;
  const needed = pixelBufferLength(kind, width, height);
  if (!(pixels > 0) || needed === null || data.length < needed) return null;

  if (kind === RGBA_32BPP) {
    return { width, height, data: clamped(data.subarray(0, pixels * 4)) };
  }

  if (kind === RGB_24BPP) {
    const out = new Uint8ClampedArray(pixels * 4);
    for (let i = 0, j = 0, k = 0; i < pixels; i++) {
      out[j++] = data[k++];
      out[j++] = data[k++];
      out[j++] = data[k++];
      out[j++] = 255;
    }
    return { width, height, data: out };
  }

  if (kind === GRAYSCALE_1BPP) {
    const stride = Math.ceil(width / 8);
    const out = new Uint8ClampedArray(pixels * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const white = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1; // a set bit is white
        const value = white ? 255 : 0;
        const j = (y * width + x) * 4;
        out[j] = out[j + 1] = out[j + 2] = value;
        out[j + 3] = 255;
      }
    }
    return { width, height, data: out };
  }

  return null;
}

/**
 * Reads back a browser `ImageBitmap`. pdf.js hands JPEG-backed images over as
 * bitmaps where the browser can decode them natively, so the pixels only
 * exist inside the bitmap.
 */
export function bitmapToRgba(
  bitmap: { width: number; height: number },
  env: Pick<CanvasEnv, "createCanvas">,
): RawImage | null {
  const canvas = env.createCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

function clamped(data: Uint8Array | Uint8ClampedArray): Uint8ClampedArray {
  return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
}

/**
 * 64-bit content hash as 16 hex characters: two independent FNV-1a lanes
 * over the bytes, after `salt` (callers put the dimensions there so equal
 * bytes at different shapes differ). A collision would drop a real image as a
 * "duplicate", so one 32-bit lane is not enough; this is not cryptographic.
 * Browser-safe — no `node:crypto`.
 */
export function hashBytes(bytes: Uint8Array | Uint8ClampedArray, salt = ""): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < salt.length; i++) {
    const c = salt.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b);
  }
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

const EPSILON = 1e-6;

/**
 * Composes a row's fragments into one RGBA image on white paper.
 *
 * Each output pixel is mapped back through the fragment's transform to a
 * source pixel (nearest neighbour), so flips and rotations fall out of the
 * same code path as the common upright case. Fragments are painted in row
 * order (left to right), so a later one covers an overlapping earlier one,
 * as on the page. Resolution is the sharpest fragment's px-per-point, scaled
 * down only if the row would pass `OCR_MAX_ITEM_PIXELS`.
 */
export function stitchRow(
  row: ImageRow<ScannedPdfImage>,
  getPixels: (fragment: ScannedPdfImage) => RawImage,
): RawImage {
  const { box } = row;

  let scale = 0;
  for (const f of row.fragments) {
    const [a, b, c, d] = f.transform;
    const lengthX = Math.hypot(a, b);
    const lengthY = Math.hypot(c, d);
    if (lengthX > 0) scale = Math.max(scale, f.pxWidth / lengthX);
    if (lengthY > 0) scale = Math.max(scale, f.pxHeight / lengthY);
  }
  if (!(scale > 0)) scale = 1;

  let width = Math.max(1, Math.ceil(box.width * scale - EPSILON));
  let height = Math.max(1, Math.ceil(box.height * scale - EPSILON));
  if (width * height > OCR_MAX_ITEM_PIXELS) {
    scale *= Math.sqrt(OCR_MAX_ITEM_PIXELS / (width * height));
    width = Math.max(1, Math.floor(box.width * scale));
    height = Math.max(1, Math.floor(box.height * scale));
  }

  const data = new Uint8ClampedArray(width * height * 4).fill(255);

  for (const f of row.fragments) {
    const [a, b, c, d, e, g] = f.transform;
    const det = a * d - b * c;
    if (Math.abs(det) < EPSILON) continue;

    const source = getPixels(f);
    const x0 = Math.max(0, Math.floor((f.x - box.x) * scale));
    const x1 = Math.min(width, Math.ceil((f.x + f.width - box.x) * scale));
    const y0 = Math.max(0, Math.floor((f.y - box.y) * scale));
    const y1 = Math.min(height, Math.ceil((f.y + f.height - box.y) * scale));

    for (let oy = y0; oy < y1; oy++) {
      const dy = box.y + (oy + 0.5) / scale - g;
      for (let ox = x0; ox < x1; ox++) {
        const dx = box.x + (ox + 0.5) / scale - e;
        const u = (d * dx - c * dy) / det;
        const v = (a * dy - b * dx) / det;
        if (u < 0 || u >= 1 || v < 0 || v > 1) continue;

        const sx = Math.min(source.width - 1, Math.floor(u * source.width));
        const sy = Math.min(source.height - 1, Math.floor((1 - v) * source.height));
        const s = (sy * source.width + sx) * 4;
        const o = (oy * width + ox) * 4;
        const alpha = source.data[s + 3];
        if (alpha === 255) {
          data[o] = source.data[s];
          data[o + 1] = source.data[s + 1];
          data[o + 2] = source.data[s + 2];
        } else if (alpha > 0) {
          const keep = 255 - alpha;
          data[o] = (source.data[s] * alpha + data[o] * keep) / 255;
          data[o + 1] = (source.data[s + 1] * alpha + data[o + 1] * keep) / 255;
          data[o + 2] = (source.data[s + 2] * alpha + data[o + 2] * keep) / 255;
        }
      }
    }
  }

  return { width, height, data };
}
