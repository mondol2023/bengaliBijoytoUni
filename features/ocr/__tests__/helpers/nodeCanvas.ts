import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { CanvasEnv } from "../../extract/canvas";
import type { RawImage } from "../../types";

/** The extractors' graphics environment, backed by `@napi-rs/canvas` for vitest. */
export const nodeCanvasEnv: CanvasEnv = {
  createCanvas(width, height) {
    return createCanvas(width, height) as unknown as ReturnType<CanvasEnv["createCanvas"]>;
  },
  async decodeImage(bytes): Promise<RawImage | null> {
    try {
      const image = await loadImage(Buffer.from(bytes));
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const { width, height, data } = context.getImageData(0, 0, image.width, image.height);
      return { width, height, data: new Uint8ClampedArray(data) };
    } catch {
      return null;
    }
  },
};

/** A real PNG of one flat colour. */
export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = `rgb(${r},${g},${b})`;
  context.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}
