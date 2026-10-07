import { describe, expect, it } from "vitest";
import { readImageSize } from "../extract/imageSize";
import { solidPng } from "./helpers/nodeCanvas";

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  bytes.set([width & 255, width >> 8, height & 255, height >> 8], 6);
  return bytes;
}

function bmp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(54);
  bytes.set([0x42, 0x4d]); // BM
  new DataView(bytes.buffer).setUint32(14, 40, true); // BITMAPINFOHEADER
  new DataView(bytes.buffer).setInt32(18, width, true);
  new DataView(bytes.buffer).setInt32(22, height, true);
  return bytes;
}

/** SOI, an APP0 segment to skip, then SOF0 with the size. */
function jpeg(width: number, height: number, marker = 0xc0): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, marker, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00,
  ]);
}

describe("readImageSize", () => {
  it("reads a real PNG", () => {
    expect(readImageSize(solidPng(37, 11, [1, 2, 3]))).toEqual({ width: 37, height: 11, mime: "image/png" });
  });

  it("reads GIF, BMP (top-down height is negative) and JPEG headers", () => {
    expect(readImageSize(gif(300, 120))).toEqual({ width: 300, height: 120, mime: "image/gif" });
    expect(readImageSize(bmp(640, 480))).toEqual({ width: 640, height: 480, mime: "image/bmp" });
    expect(readImageSize(bmp(640, -480))).toEqual({ width: 640, height: 480, mime: "image/bmp" });
    expect(readImageSize(jpeg(1024, 768))).toEqual({ width: 1024, height: 768, mime: "image/jpeg" });
  });

  it("reads a progressive JPEG (SOF2) but not the DHT marker that sits among the SOFs", () => {
    expect(readImageSize(jpeg(50, 60, 0xc2))).toEqual({ width: 50, height: 60, mime: "image/jpeg" });
    expect(readImageSize(jpeg(50, 60, 0xc4))).toBeNull();
  });

  it("returns null for anything else, including truncated data", () => {
    expect(readImageSize(new Uint8Array([]))).toBeNull();
    expect(readImageSize(new TextEncoder().encode("not an image at all"))).toBeNull();
    expect(readImageSize(solidPng(10, 10, [0, 0, 0]).slice(0, 12))).toBeNull();
    expect(readImageSize(jpeg(10, 10).slice(0, 14))).toBeNull();
  });
});
