import { describe, expect, it } from "vitest";
import { OCR_MAX_ITEM_PIXELS } from "../config";
import { bitmapToRgba, hashBytes, stitchRow, toRgba } from "../extract/pixels";
import { nodeCanvasEnv } from "./helpers/nodeCanvas";
import type { ImageRow, Matrix, RawImage, ScannedPdfImage } from "../types";

const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

function px(image: RawImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return Array.from(image.data.slice(i, i + 4));
}

function raw(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}

const RED: [number, number, number, number] = [255, 0, 0, 255];
const GREEN: [number, number, number, number] = [0, 255, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];

describe("toRgba", () => {
  it("passes RGBA through", () => {
    const data = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toRgba({ width: 2, height: 1, kind: RGBA_32BPP, data })).toEqual({ width: 2, height: 1, data });
  });

  it("expands RGB with an opaque alpha", () => {
    const image = toRgba({ width: 2, height: 1, kind: RGB_24BPP, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6]) });
    expect(Array.from(image!.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it("unpacks 1-bit rows, a set bit being white, padding each row to a byte", () => {
    // 3 px wide → one byte per row; row 0 = 101, row 1 = 010 (high bits first).
    const image = toRgba({ width: 3, height: 2, kind: GRAYSCALE_1BPP, data: new Uint8ClampedArray([0b10100000, 0b01000000]) });
    expect(px(image!, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(image!, 1, 0)).toEqual([0, 0, 0, 255]);
    expect(px(image!, 2, 0)).toEqual([255, 255, 255, 255]);
    expect(px(image!, 0, 1)).toEqual([0, 0, 0, 255]);
    expect(px(image!, 1, 1)).toEqual([255, 255, 255, 255]);
  });

  it("returns null when the buffer is shorter than the dimensions claim", () => {
    expect(toRgba({ width: 10, height: 10, kind: RGB_24BPP, data: new Uint8ClampedArray(5) })).toBeNull();
  });

  it("returns null for an unknown kind", () => {
    expect(toRgba({ width: 1, height: 1, kind: 9, data: new Uint8ClampedArray(4) })).toBeNull();
  });
});

describe("bitmapToRgba", () => {
  it("reads a browser ImageBitmap back to RGBA by drawing it on a canvas", () => {
    // A filled canvas stands in for the bitmap: drawImage accepts either.
    const stand = nodeCanvasEnv.createCanvas(3, 2);
    const paint = stand.getContext("2d") as unknown as { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
    paint.fillStyle = "rgb(0,255,0)";
    paint.fillRect(0, 0, 3, 2);

    const image = bitmapToRgba(stand, nodeCanvasEnv);
    expect(image).toMatchObject({ width: 3, height: 2 });
    expect(px(image!, 2, 1)).toEqual([0, 255, 0, 255]);
  });

  // pdf.js hands back a WebCodecs VideoFrame for JPEGs: it has displayWidth, not width.
  it("takes the size from the caller when the source has none", () => {
    const calls: number[][] = [];
    const env = {
      createCanvas: (w: number, h: number) => ({
        width: w,
        height: h,
        getContext: () => ({
          drawImage() {},
          getImageData: (...args: number[]) => {
            calls.push(args);
            return { width: args[2], height: args[3], data: new Uint8ClampedArray(args[2] * args[3] * 4) };
          },
        }),
      }),
    };
    expect(bitmapToRgba({}, env, { width: 3, height: 2 })).toMatchObject({ width: 3, height: 2 });
    expect(calls).toEqual([[0, 0, 3, 2]]);
  });

  it("returns null when the environment gives no 2D context", () => {
    const noContext = { createCanvas: () => ({ width: 1, height: 1, getContext: () => null }) };
    expect(bitmapToRgba({ width: 1, height: 1 }, noContext)).toBeNull();
  });
});

describe("hashBytes", () => {
  it("is stable and 16 hex characters", () => {
    const a = hashBytes(new Uint8Array([1, 2, 3]), "x");
    expect(a).toBe(hashBytes(new Uint8Array([1, 2, 3]), "x"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs when a byte or the salt differs — the salt carries the dimensions", () => {
    const base = hashBytes(new Uint8Array([1, 2, 3, 4]), "2x2");
    expect(hashBytes(new Uint8Array([1, 2, 3, 5]), "2x2")).not.toBe(base);
    expect(hashBytes(new Uint8Array([1, 2, 3, 4]), "4x1")).not.toBe(base);
  });
});

/** An image drawn upright at (x, y) pt, `width × height` pt, top-left origin. */
function fragment(over: Partial<ScannedPdfImage> & { x: number; y: number; width: number; height: number; pxWidth: number; pxHeight: number }): ScannedPdfImage {
  const transform: Matrix = [over.width, 0, 0, -over.height, over.x, over.y + over.height];
  return { page: 1, hash: "h", opIndex: 0, transform, ...over };
}

function rowOf(fragments: ScannedPdfImage[]): ImageRow<ScannedPdfImage> {
  const left = Math.min(...fragments.map((f) => f.x));
  const top = Math.min(...fragments.map((f) => f.y));
  const right = Math.max(...fragments.map((f) => f.x + f.width));
  const bottom = Math.max(...fragments.map((f) => f.y + f.height));
  return { page: 1, box: { x: left, y: top, width: right - left, height: bottom - top }, fragments };
}

describe("stitchRow", () => {
  it("copies a single upright fragment 1:1", () => {
    const f = fragment({ x: 10, y: 20, width: 4, height: 2, pxWidth: 4, pxHeight: 2 });
    const source = raw(4, 2, (x, y) => [x * 10, y * 10, 7, 255]);
    const out = stitchRow(rowOf([f]), () => source);
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
    expect(Array.from(out.data)).toEqual(Array.from(source.data));
  });

  it("lays fragments side by side at their placement", () => {
    const left = fragment({ x: 0, y: 0, width: 3, height: 2, pxWidth: 3, pxHeight: 2, opIndex: 1 });
    const right = fragment({ x: 3, y: 0, width: 3, height: 2, pxWidth: 3, pxHeight: 2, opIndex: 2 });
    const out = stitchRow(rowOf([left, right]), (f) => raw(3, 2, () => (f.opIndex === 1 ? RED : GREEN)));
    expect(out.width).toBe(6);
    expect(px(out, 2, 1)).toEqual(RED);
    expect(px(out, 3, 1)).toEqual(GREEN);
  });

  it("lets a later fragment cover an overlapping earlier one", () => {
    const a = fragment({ x: 0, y: 0, width: 4, height: 2, pxWidth: 4, pxHeight: 2, opIndex: 1 });
    const b = fragment({ x: 2, y: 0, width: 4, height: 2, pxWidth: 4, pxHeight: 2, opIndex: 2 });
    const out = stitchRow(rowOf([a, b]), (f) => raw(4, 2, () => (f.opIndex === 1 ? RED : GREEN)));
    expect(px(out, 1, 0)).toEqual(RED);
    expect(px(out, 2, 0)).toEqual(GREEN);
    expect(px(out, 5, 0)).toEqual(GREEN);
  });

  it("composites transparency over white", () => {
    const f = fragment({ x: 0, y: 0, width: 2, height: 1, pxWidth: 2, pxHeight: 1 });
    const out = stitchRow(rowOf([f]), () => raw(2, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [0, 0, 0, 255])));
    expect(px(out, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(out, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it("leaves uncovered gaps white", () => {
    const a = fragment({ x: 0, y: 0, width: 2, height: 1, pxWidth: 2, pxHeight: 1, opIndex: 1 });
    const b = fragment({ x: 4, y: 0, width: 2, height: 1, pxWidth: 2, pxHeight: 1, opIndex: 2 });
    const out = stitchRow(rowOf([a, b]), () => raw(2, 1, () => BLUE));
    expect(px(out, 3, 0)).toEqual([255, 255, 255, 255]);
  });

  it("renders at the sharpest fragment's density, resampling the coarser one", () => {
    // 2 px/pt fragment next to a 1 px/pt fragment: the row is 2 px/pt.
    const fine = fragment({ x: 0, y: 0, width: 2, height: 2, pxWidth: 4, pxHeight: 4, opIndex: 1 });
    const coarse = fragment({ x: 2, y: 0, width: 2, height: 2, pxWidth: 2, pxHeight: 2, opIndex: 2 });
    const out = stitchRow(rowOf([fine, coarse]), (f) => (f.opIndex === 1 ? raw(4, 4, () => RED) : raw(2, 2, () => GREEN)));
    expect(out.width).toBe(8);
    expect(out.height).toBe(4);
    expect(px(out, 3, 3)).toEqual(RED);
    expect(px(out, 4, 0)).toEqual(GREEN);
    expect(px(out, 7, 3)).toEqual(GREEN);
  });

  it("draws a vertically flipped image upright-corrected (positive d means upside down)", () => {
    // Source: top row red, bottom row blue. A flipped transform shows blue on top.
    const flipped = fragment({ x: 0, y: 0, width: 1, height: 2, pxWidth: 1, pxHeight: 2, transform: [1, 0, 0, 2, 0, 0] });
    const out = stitchRow(rowOf([flipped]), () => raw(1, 2, (_, y) => (y === 0 ? RED : BLUE)));
    expect(px(out, 0, 0)).toEqual(BLUE);
    expect(px(out, 0, 1)).toEqual(RED);
  });

  it("draws a horizontally mirrored image mirrored (negative a)", () => {
    const mirrored = fragment({ x: 0, y: 0, width: 2, height: 1, pxWidth: 2, pxHeight: 1, transform: [-2, 0, 0, -1, 2, 1] });
    const out = stitchRow(rowOf([mirrored]), () => raw(2, 1, (x) => (x === 0 ? RED : BLUE)));
    expect(px(out, 0, 0)).toEqual(BLUE);
    expect(px(out, 1, 0)).toEqual(RED);
  });

  it("follows a quarter-turn rotation", () => {
    // Source 2 wide × 1 tall: left red, right blue. Rotated so its width runs down the page:
    // unit u (image x) → +Y, v (image up) → +X. Box is 1 pt wide, 2 pt tall.
    const rotated = fragment({ x: 0, y: 0, width: 1, height: 2, pxWidth: 2, pxHeight: 1, transform: [0, 2, 1, 0, 0, 0] });
    const out = stitchRow(rowOf([rotated]), () => raw(2, 1, (x) => (x === 0 ? RED : BLUE)));
    expect(out.width).toBe(1);
    expect(out.height).toBe(2);
    expect(px(out, 0, 0)).toEqual(RED);
    expect(px(out, 0, 1)).toEqual(BLUE);
  });

  it("scales a huge row down to stay inside the per-item pixel cap", () => {
    // 20 000 × 2 000 px would be 40M px; the cap is 16M.
    const f = fragment({ x: 0, y: 0, width: 200, height: 20, pxWidth: 20_000, pxHeight: 2_000 });
    const out = stitchRow(rowOf([f]), () => raw(1, 1, () => RED));
    expect(out.width * out.height).toBeLessThanOrEqual(OCR_MAX_ITEM_PIXELS);
    expect(out.width / out.height).toBeCloseTo(10, 0);
  });
});
