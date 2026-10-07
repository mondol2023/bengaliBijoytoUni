import { describe, expect, it } from "vitest";
import { encodeBmp } from "../engine/bmp";
import type { RawImage } from "../types";

function image(width: number, height: number, pixels: Array<[number, number, number, number]>): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b, a], i) => data.set([r, g, b, a], i * 4));
  return { width, height, data };
}

describe("encodeBmp", () => {
  it("writes a 24-bit BMP header with the right sizes", () => {
    const bytes = encodeBmp(image(2, 2, [[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]]));
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("BM");
    expect(view.getUint32(2, true)).toBe(bytes.length);
    expect(view.getUint32(10, true)).toBe(54); // pixel data offset
    expect(view.getInt32(18, true)).toBe(2); // width
    expect(view.getInt32(22, true)).toBe(2); // positive height = bottom-up rows
    expect(view.getUint16(28, true)).toBe(24); // bits per pixel
    expect(view.getUint32(30, true)).toBe(0); // BI_RGB, no compression
  });

  it("pads each row to a multiple of 4 bytes", () => {
    // 1 px wide = 3 bytes per row → padded to 4; 3 px wide = 9 → 12.
    expect(encodeBmp(image(1, 2, [[0, 0, 0, 255], [0, 0, 0, 255]])).length).toBe(54 + 4 * 2);
    expect(encodeBmp(image(3, 1, [[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]])).length).toBe(54 + 12);
  });

  it("stores pixels as BGR with the bottom image row first", () => {
    const top = [255, 0, 0, 255] as [number, number, number, number]; // red
    const bottom = [0, 0, 255, 255] as [number, number, number, number]; // blue
    const bytes = encodeBmp(image(1, 2, [top, bottom]));
    expect([...bytes.subarray(54, 57)]).toEqual([255, 0, 0]); // blue pixel (B,G,R) first
    expect([...bytes.subarray(58, 61)]).toEqual([0, 0, 255]); // then red
  });

  it("flattens transparency onto white so a transparent background reads as paper", () => {
    const bytes = encodeBmp(image(1, 1, [[0, 0, 0, 0]]));
    expect([...bytes.subarray(54, 57)]).toEqual([255, 255, 255]);
  });

  it("blends a half-transparent pixel with white", () => {
    const bytes = encodeBmp(image(1, 1, [[0, 0, 0, 128]]));
    expect(bytes[54]).toBeGreaterThan(120);
    expect(bytes[54]).toBeLessThan(135);
  });
});
