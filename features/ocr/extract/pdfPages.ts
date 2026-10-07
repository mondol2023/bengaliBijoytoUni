/**
 * Whole-page mode: renders a PDF page to pixels, for pages whose text is
 * drawn as a picture. pdf.js draws onto an injected canvas, so this runs in
 * the browser and (with `@napi-rs/canvas`) in vitest.
 */
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import { pageRenderScale } from "../config";
import type { RawImage } from "../types";
import type { CanvasEnv } from "./canvas";
import type { OpenPdf } from "./openPdf";

/** Renders one page (1-based) at ~2×, scaled down if that would pass the pixel budget, on opaque white. */
export async function renderPdfPage(
  pdf: OpenPdf,
  pageNumber: number,
  env: Pick<CanvasEnv, "createCanvas">,
): Promise<Result<RawImage>> {
  try {
    const page = await pdf.doc.getPage(pageNumber);
    try {
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pageRenderScale(natural.width, natural.height) });
      // Floor, not ceil: the pixel budget is a hard cap and a fraction of a pixel of margin is not text.
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));

      const canvas = env.createCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2D canvas context");

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        background: "rgb(255,255,255)",
      }).promise;

      return ok(context.getImageData(0, 0, width, height));
    } finally {
      page.cleanup();
    }
  } catch (cause) {
    return err(
      AppErrors.fileProcessing(`Could not render page ${pageNumber} of this PDF.`, {
        details: { fileType: "pdf", reason: "extraction_failed" },
        debug: cause,
      }),
    );
  }
}
