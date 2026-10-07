import type { CanvasEnv, OcrCanvas } from "./canvas";
import { bitmapToRgba } from "./pixels";

/**
 * The extractors' graphics environment in a real browser: a DOM canvas and
 * `createImageBitmap`. Browser-only — it touches `document` — so nothing on a
 * server path may import it. vitest covers the wiring with stubbed globals;
 * the decode itself needs a real-browser check (Phase 4).
 */
export const browserCanvasEnv: CanvasEnv = {
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const getContext = canvas.getContext.bind(canvas) as (type: "2d", options?: unknown) => ReturnType<OcrCanvas["getContext"]>;
    // Every canvas here is read back with `getImageData`; this keeps it in CPU memory instead of
    // a GPU texture that would be copied out on each read.
    canvas.getContext = ((type: "2d") => getContext(type, { willReadFrequently: true })) as typeof canvas.getContext;
    return canvas as unknown as OcrCanvas;
  },

  async decodeImage(bytes, mime) {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
      try {
        return bitmapToRgba(bitmap, browserCanvasEnv);
      } finally {
        bitmap.close();
      }
    } catch {
      return null;
    }
  },
};
