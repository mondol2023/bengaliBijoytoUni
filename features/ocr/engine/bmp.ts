import type { RawImage } from "../types";

const HEADER_BYTES = 54; // 14-byte file header + 40-byte BITMAPINFOHEADER

/**
 * Encodes RGBA pixels as an uncompressed 24-bit BMP. Tesseract's browser build
 * takes image *bytes* (not `ImageData`), and a BMP needs no canvas or codec to
 * produce — so the engine stays isomorphic and the same bytes work in vitest.
 * Transparency is flattened onto white: a transparent background is paper.
 */
export function encodeBmp({ width, height, data }: RawImage): Uint8Array {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const out = new Uint8Array(HEADER_BYTES + pixelBytes);
  const view = new DataView(out.buffer);

  out[0] = 0x42; // "B"
  out[1] = 0x4d; // "M"
  view.setUint32(2, out.length, true);
  view.setUint32(10, HEADER_BYTES, true);
  view.setUint32(14, 40, true); // info header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: rows are stored bottom-up
  view.setUint16(26, 1, true); // colour planes
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);

  for (let y = 0; y < height; y++) {
    let o = HEADER_BYTES + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] / 255;
      out[o++] = flatten(data[i + 2], alpha);
      out[o++] = flatten(data[i + 1], alpha);
      out[o++] = flatten(data[i], alpha);
    }
  }
  return out;
}

function flatten(channel: number, alpha: number): number {
  return Math.round(channel * alpha + 255 * (1 - alpha));
}
