import { describe, expect, it } from "vitest";
import { OCR_MAX_PAGE_PIXELS, OCR_PAGE_RENDER_SCALE } from "../config";
import { openPdf, type PdfjsLoader } from "../extract/openPdf";
import { renderPdfPage } from "../extract/pdfPages";
import type { RawImage } from "../types";
import { nodeCanvasEnv } from "./helpers/nodeCanvas";
import { buildPdf, solidRgb } from "./helpers/pdfFixture";

const loader: PdfjsLoader = () => import("pdfjs-dist/legacy/build/pdf.mjs") as ReturnType<PdfjsLoader>;

function px(image: RawImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return Array.from(image.data.slice(i, i + 4));
}

async function renderFirstPage(bytes: Uint8Array, pageNumber = 1) {
  const opened = await openPdf(bytes, { loader });
  if (!opened.ok) throw new Error(opened.error.message);
  return renderPdfPage(opened.value, pageNumber, nodeCanvasEnv);
}

describe("renderPdfPage", () => {
  it("renders at 2x with the image where the page draws it and white elsewhere", async () => {
    // 100 × 100 pt page; a 30 × 30 pt blue square whose lower-left corner is (10, 60) → top-left (10, 10).
    const bytes = buildPdf(
      [{ width: 100, height: 100, content: "q 30 0 0 30 10 60 cm /Im1 Do Q" }],
      { Im1: solidRgb(4, 4, [0, 0, 255]) },
    );
    const result = await renderFirstPage(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const page = result.value;
    expect(page.width).toBe(100 * OCR_PAGE_RENDER_SCALE);
    expect(page.height).toBe(100 * OCR_PAGE_RENDER_SCALE);
    expect(px(page, 50, 50)).toEqual([0, 0, 255, 255]); // inside the square (20..80 px)
    expect(px(page, 150, 150)).toEqual([255, 255, 255, 255]); // blank paper is opaque white
  });

  it("scales an oversize page down to stay inside the pixel budget", async () => {
    const bytes = buildPdf([{ width: 3000, height: 3000, content: "" }]);
    const result = await renderFirstPage(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.width * result.value.height).toBeLessThanOrEqual(OCR_MAX_PAGE_PIXELS);
    expect(result.value.width).toBeLessThan(3000 * OCR_PAGE_RENDER_SCALE);
  });

  it("renders the page asked for", async () => {
    const bytes = buildPdf(
      [
        { width: 50, height: 50, content: "" },
        { width: 80, height: 40, content: "" },
      ],
    );
    const result = await renderFirstPage(bytes, 2);
    expect(result.ok && [result.value.width, result.value.height]).toEqual([160, 80]);
  });

  it("returns a user-safe error for a page that does not exist", async () => {
    const result = await renderFirstPage(buildPdf([{ width: 50, height: 50, content: "" }]), 5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
  });
});
