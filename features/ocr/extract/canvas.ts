import type { RawImage } from "../types";

/**
 * The two things extraction needs from a graphics environment, injected so
 * the extractors run unchanged in the browser (DOM canvas, `createImageBitmap`)
 * and in vitest (`@napi-rs/canvas`). Nothing in `extract/` touches `document`.
 */

/** The slice of a 2D context the extractors read back from. */
export interface OcrContext2D {
  /** `image` is an `ImageBitmap`, a canvas, or whatever the environment's context accepts. */
  drawImage(image: unknown, dx: number, dy: number): void;
  getImageData(x: number, y: number, width: number, height: number): RawImage;
}

export interface OcrCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): OcrContext2D | null;
}

export interface CanvasEnv {
  createCanvas(width: number, height: number): OcrCanvas;
  /** Decodes PNG/JPEG/GIF/BMP bytes to RGBA, or null when the environment cannot. */
  decodeImage(bytes: Uint8Array, mime: string): Promise<RawImage | null>;
}
