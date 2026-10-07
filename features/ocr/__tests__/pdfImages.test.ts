import { describe, expect, it } from "vitest";
import { OCR_MAX_FILE_BYTES, OCR_MAX_PAGES } from "../config";
import { createRowRenderer, scanPdfImages } from "../extract/pdfImages";
import { openPdf, type PdfjsLoader } from "../extract/openPdf";
import { groupIntoRows } from "../extract/filter";
import type { RawImage, ScannedPdfImage } from "../types";
import { buildPdf, patternRgb, solidRgb } from "./helpers/pdfFixture";

// Node can't run the browser build; the legacy build is the same API.
const loader: PdfjsLoader = () => import("pdfjs-dist/legacy/build/pdf.mjs") as ReturnType<PdfjsLoader>;

async function open(bytes: Uint8Array) {
  const result = await openPdf(bytes, { loader });
  if (!result.ok) throw new Error(`fixture failed to open: ${result.error.message}`);
  return result.value;
}

async function scan(bytes: Uint8Array) {
  const doc = await open(bytes);
  const result = await scanPdfImages(doc);
  if (!result.ok) throw new Error(result.error.message);
  return { doc, ...result.value };
}

function px(image: RawImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return Array.from(image.data.slice(i, i + 4));
}

const PAGE = { width: 612, height: 792 };

describe("openPdf", () => {
  it("refuses an oversize file before parsing it", async () => {
    const result = await openPdf(new Uint8Array(OCR_MAX_FILE_BYTES + 1), { loader });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ reason: "too_large" });
  });

  it("reports garbage as an unreadable PDF without leaking internals", async () => {
    const result = await openPdf(new TextEncoder().encode("this is not a pdf"), { loader });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
    expect(result.error.message).not.toMatch(/Exception|stack|\bat \w+/);
  });

  it("refuses a PDF over the page cap", async () => {
    const pages = Array.from({ length: OCR_MAX_PAGES + 1 }, () => ({ ...PAGE, content: "" }));
    const result = await openPdf(buildPdf(pages), { loader });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ reason: "too_large" });
  });

  it("accepts a PDF at the page cap", async () => {
    const pages = Array.from({ length: OCR_MAX_PAGES }, () => ({ ...PAGE, content: "" }));
    expect((await openPdf(buildPdf(pages), { loader })).ok).toBe(true);
  });
});

describe("scanPdfImages", () => {
  it("finds an image's placement in top-left page points, with its pixel size", async () => {
    // PDF space: 100 × 50 pt, lower-left corner at (40, 700) → spans y 700..750 → top-left y = 792 - 750 = 42.
    const bytes = buildPdf(
      [{ ...PAGE, content: "q 100 0 0 50 40 700 cm /Im1 Do Q" }],
      { Im1: solidRgb(20, 10, [255, 0, 0]) },
    );
    const { images, pageCount, unreadable } = await scan(bytes);
    expect(pageCount).toBe(1);
    expect(unreadable).toBe(0);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ page: 1, x: 40, y: 42, width: 100, height: 50, pxWidth: 20, pxHeight: 10 });
    expect(images[0].hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("composes nested transforms", async () => {
    // Outer scale 2, inner 50 × 25 at (10, 20): spans x 20..120, PDF y 40..90 → top-left y 702, height 50.
    const bytes = buildPdf(
      [{ ...PAGE, content: "q 2 0 0 2 0 0 cm q 50 0 0 25 10 20 cm /Im1 Do Q Q" }],
      { Im1: solidRgb(8, 4, [0, 0, 255]) },
    );
    const { images } = await scan(bytes);
    expect(images[0]).toMatchObject({ x: 20, y: 702, width: 100, height: 50 });
  });

  it("restores the transform after Q, so a later image is not offset by an earlier one", async () => {
    const bytes = buildPdf(
      [{ ...PAGE, content: "q 3 0 0 3 100 100 cm Q q 30 0 0 30 10 10 cm /Im1 Do Q" }],
      { Im1: solidRgb(4, 4, [0, 255, 0]) },
    );
    const { images } = await scan(bytes);
    expect(images[0]).toMatchObject({ x: 10, y: 792 - 40, width: 30, height: 30 });
  });

  it("reports each paint separately but gives identical pixels the same hash", async () => {
    const bytes = buildPdf(
      [{ ...PAGE, content: "q 50 0 0 50 10 700 cm /Im1 Do Q q 50 0 0 50 300 700 cm /Im1 Do Q q 50 0 0 50 10 600 cm /Im2 Do Q" }],
      { Im1: solidRgb(8, 8, [255, 0, 0]), Im2: solidRgb(8, 8, [0, 0, 255]) },
    );
    const { images } = await scan(bytes);
    expect(images).toHaveLength(3);
    expect(images[0].hash).toBe(images[1].hash);
    expect(images[0].hash).not.toBe(images[2].hash);
    expect(new Set(images.map((i) => i.opIndex)).size).toBe(3);
  });

  it("numbers images by page", async () => {
    const bytes = buildPdf(
      [
        { ...PAGE, content: "q 50 0 0 50 10 10 cm /Im1 Do Q" },
        { ...PAGE, content: "" },
        { ...PAGE, content: "q 50 0 0 50 10 10 cm /Im1 Do Q" },
      ],
      { Im1: solidRgb(8, 8, [1, 2, 3]) },
    );
    const { images, pageCount } = await scan(bytes);
    expect(pageCount).toBe(3);
    expect(images.map((i) => i.page)).toEqual([1, 3]);
  });

  it("returns an empty scan for a PDF with no images", async () => {
    const { images } = await scan(buildPdf([{ ...PAGE, content: "" }]));
    expect(images).toEqual([]);
  });

  it("skips an image over the per-item pixel cap and counts it as unreadable", async () => {
    // 5 000 × 4 000 = 20M px > 16M. All-zero pixels compress to almost nothing.
    const huge = { width: 5000, height: 4000, rgb: new Uint8Array(5000 * 4000 * 3) };
    const bytes = buildPdf([{ ...PAGE, content: "q 100 0 0 80 10 10 cm /Big Do Q" }], { Big: huge });
    const { images, unreadable } = await scan(bytes);
    expect(images).toEqual([]);
    expect(unreadable).toBe(1);
  });

  it("stops early when the signal is already aborted", async () => {
    const doc = await open(buildPdf([{ ...PAGE, content: "" }]));
    const controller = new AbortController();
    controller.abort();
    const result = await scanPdfImages(doc, { signal: controller.signal });
    expect(result.ok).toBe(false);
  });

  it("reports progress once per page", async () => {
    const doc = await open(buildPdf([{ ...PAGE, content: "" }, { ...PAGE, content: "" }]));
    const seen: Array<[number, number]> = [];
    await scanPdfImages(doc, { onPage: (page, total) => seen.push([page, total]) });
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });
});

describe("createRowRenderer", () => {
  async function render(bytes: Uint8Array, pick: (images: ScannedPdfImage[]) => ScannedPdfImage[]) {
    const { doc, images } = await scan(bytes);
    const renderer = createRowRenderer(doc);
    const [row] = groupIntoRows(pick(images));
    const result = await renderer.render(row);
    renderer.dispose();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  it("stitches a line drawn as adjacent fragments into one image", async () => {
    // Two 40 × 40 pt fragments, 40 × 40 px each (1 px/pt), side by side: red then green.
    const bytes = buildPdf(
      [{ ...PAGE, content: "q 40 0 0 40 100 600 cm /Red Do Q q 40 0 0 40 140 600 cm /Green Do Q" }],
      { Red: solidRgb(40, 40, [255, 0, 0]), Green: solidRgb(40, 40, [0, 255, 0]) },
    );
    const stitched = await render(bytes, (images) => images);
    expect(stitched.width).toBe(80);
    expect(stitched.height).toBe(40);
    expect(px(stitched, 10, 20)).toEqual([255, 0, 0, 255]);
    expect(px(stitched, 70, 20)).toEqual([0, 255, 0, 255]);
  });

  it("keeps a fragment upright: the image's top row ends up on top", async () => {
    const bytes = buildPdf(
      [{ ...PAGE, content: "q 10 0 0 20 100 600 cm /Tb Do Q" }],
      { Tb: patternRgb(10, 20, (_, y) => (y < 10 ? [255, 0, 0] : [0, 0, 255])) },
    );
    const stitched = await render(bytes, (images) => images);
    expect(px(stitched, 5, 2)).toEqual([255, 0, 0, 255]);
    expect(px(stitched, 5, 17)).toEqual([0, 0, 255, 255]);
  });

  it("renders the right fragments when the same renderer moves across pages", async () => {
    const bytes = buildPdf(
      [
        { ...PAGE, content: "q 40 0 0 40 100 600 cm /Red Do Q" },
        { ...PAGE, content: "q 40 0 0 40 100 600 cm /Green Do Q" },
      ],
      { Red: solidRgb(40, 40, [255, 0, 0]), Green: solidRgb(40, 40, [0, 255, 0]) },
    );
    const { doc, images } = await scan(bytes);
    const renderer = createRowRenderer(doc);
    const rows = groupIntoRows(images);
    const first = await renderer.render(rows[0]);
    const second = await renderer.render(rows[1]);
    const again = await renderer.render(rows[0]);
    renderer.dispose();
    expect(first.ok && px(first.value, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(second.ok && px(second.value, 5, 5)).toEqual([0, 255, 0, 255]);
    expect(again.ok && px(again.value, 5, 5)).toEqual([255, 0, 0, 255]);
  });
});
