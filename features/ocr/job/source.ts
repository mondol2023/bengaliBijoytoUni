/**
 * Turns an uploaded file into the list of things to read. Composes the
 * Phase 1-3 pieces (open, scan, plan, cap checks) behind one object so the
 * job runner and the scanner-bed UI never touch pdf.js or JSZip directly.
 *
 * Items are in page order, which the single shared `RowRenderer` relies on:
 * it keeps one page's operator list at a time, so jumping back and forth
 * between pages would re-parse them.
 */
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import { OCR_BED_PAGE_MAX_EDGE_PX, checkItemCap, pageRenderScale } from "../config";
import type { CanvasEnv } from "../extract/canvas";
import { decodeDocxImage, listDocxImages } from "../extract/docxImages";
import { planEmbeddedRows, planUnplacedImages } from "../extract/filter";
import { openPdf } from "../extract/openPdf";
import type { OpenPdf, OpenPdfOptions } from "../extract/openPdf";
import { createRowRenderer, scanPdfImages } from "../extract/pdfImages";
import { renderPdfPage } from "../extract/pdfPages";
import type { Box, OcrMode, RawImage } from "../types";
import type { OcrFileKind } from "./fileKind";

export type { OcrFileKind } from "./fileKind";

export interface OcrItemMeta {
  /** "p3-r4" | "page-3" | "img-5" */
  id: string;
  /** "Page 3 · line 4" | "Page 3" | "Image 5" */
  label: string;
  /** null for DOCX. */
  page: number | null;
  /** Top-left-origin points on its page (embedded PDF rows only), for the bed overlay. */
  box: Box | null;
}

export interface OcrSourceItem extends OcrItemMeta {
  /** The pixels to read, or null when this item cannot be read (counted as unreadable, not as a failure). */
  load(): Promise<RawImage | null>;
}

export interface OcrSourcePage {
  page: number;
  widthPt: number;
  heightPt: number;
}

export interface OcrSource {
  kind: OcrFileKind;
  mode: OcrMode;
  items: OcrSourceItem[];
  /** [] for DOCX. */
  pages: OcrSourcePage[];
  skipped: { decorative: number; duplicate: number; tinyRow: number };
  unreadable: number;
  /** PDF only: a low-res render of one page for the scanner bed. */
  renderPagePreview: ((page: number) => Promise<Result<RawImage>>) | null;
  dispose(): Promise<void>;
}

export interface SourceDeps {
  canvas: CanvasEnv;
  pdf?: OpenPdfOptions;
  signal?: AbortSignal;
}

/** Whole-page mode needs pages to render, which a Word document does not have. */
export function isModeAvailable(kind: OcrFileKind, mode: OcrMode): boolean {
  return !(kind === "docx" && mode === "pages");
}

const NO_SKIPS = { decorative: 0, duplicate: 0, tinyRow: 0 };

export async function prepareOcrSource(
  bytes: Uint8Array,
  kind: OcrFileKind,
  mode: OcrMode,
  deps: SourceDeps,
): Promise<Result<OcrSource>> {
  if (!isModeAvailable(kind, mode)) {
    return err(
      AppErrors.fileProcessing("Whole pages mode only works with PDF files.", {
        details: { fileType: kind, reason: "unsupported_format" },
      }),
    );
  }
  return kind === "pdf" ? preparePdf(bytes, mode, deps) : prepareDocx(bytes, deps);
}

async function prepareDocx(bytes: Uint8Array, deps: SourceDeps): Promise<Result<OcrSource>> {
  const listed = await listDocxImages(bytes);
  if (!listed.ok) return err(listed.error);

  const plan = planUnplacedImages(listed.value.images);
  if (!plan.ok) return err(plan.error);

  const items: OcrSourceItem[] = plan.value.items.map((image, index) => ({
    id: `img-${index + 1}`,
    label: `Image ${index + 1}`,
    page: null,
    box: null,
    async load() {
      const decoded = await decodeDocxImage(image, deps.canvas);
      return decoded.ok ? decoded.value : null;
    },
  }));

  return ok({
    kind: "docx",
    mode: "embedded",
    items,
    pages: [],
    skipped: { ...plan.value.skipped, tinyRow: 0 },
    unreadable: listed.value.unreadable,
    renderPagePreview: null,
    async dispose() {},
  });
}

async function preparePdf(bytes: Uint8Array, mode: OcrMode, deps: SourceDeps): Promise<Result<OcrSource>> {
  const opened = await openPdf(bytes, deps.pdf);
  if (!opened.ok) return err(opened.error);
  const pdf = opened.value;

  const built = await buildPdfSource(pdf, mode, deps);
  if (!built.ok) await pdf.close();
  return built;
}

async function buildPdfSource(pdf: OpenPdf, mode: OcrMode, deps: SourceDeps): Promise<Result<OcrSource>> {
  const pages: OcrSourcePage[] = [];
  try {
    for (let page = 1; page <= pdf.doc.numPages; page++) {
      const proxy = await pdf.doc.getPage(page);
      try {
        const view = proxy.getViewport({ scale: 1 });
        pages.push({ page, widthPt: view.width, heightPt: view.height });
      } finally {
        proxy.cleanup();
      }
    }
  } catch (cause) {
    return err(
      AppErrors.fileProcessing("Could not read this PDF — it may be corrupted.", {
        details: { fileType: "pdf", reason: "corrupted" },
        debug: cause,
      }),
    );
  }

  let disposed = false;
  let renderer: ReturnType<typeof createRowRenderer> | null = null;
  const cleanup = async () => {
    if (disposed) return;
    disposed = true;
    renderer?.dispose();
    await pdf.close();
  };

  let items: OcrSourceItem[];
  let skipped = NO_SKIPS;
  let unreadable = 0;

  if (mode === "pages") {
    const capped = checkItemCap(pages.length);
    if (!capped.ok) return err(capped.error);
    items = pages.map(({ page }) => ({
      id: `page-${page}`,
      label: `Page ${page}`,
      page,
      box: null,
      async load() {
        if (disposed) return null;
        const rendered = await renderPdfPage(pdf, page, deps.canvas);
        return rendered.ok ? rendered.value : null;
      },
    }));
  } else {
    const scanned = await scanPdfImages(pdf, { signal: deps.signal, env: deps.canvas });
    if (!scanned.ok) return err(scanned.error);
    const plan = planEmbeddedRows(scanned.value.images);
    if (!plan.ok) return err(plan.error);

    skipped = plan.value.skipped;
    unreadable = scanned.value.unreadable;
    const rowRenderer = createRowRenderer(pdf, { env: deps.canvas });
    renderer = rowRenderer;

    const lineOnPage = new Map<number, number>();
    items = plan.value.rows.map((row) => {
      const line = (lineOnPage.get(row.page) ?? 0) + 1;
      lineOnPage.set(row.page, line);
      return {
        id: `p${row.page}-r${line}`,
        label: `Page ${row.page} · line ${line}`,
        page: row.page,
        box: row.box,
        async load() {
          if (disposed) return null;
          const rendered = await rowRenderer.render(row);
          return rendered.ok ? rendered.value : null;
        },
      };
    });
  }

  return ok({
    kind: "pdf",
    mode,
    items,
    pages,
    skipped,
    unreadable,
    renderPagePreview: (page) => renderBedPreview(pdf, page, deps.canvas),
    dispose: cleanup,
  });
}

/** One page at bed-display size: no sharper than the OCR render, no bigger than the bed edge needs. */
async function renderBedPreview(
  pdf: OpenPdf,
  pageNumber: number,
  env: Pick<CanvasEnv, "createCanvas">,
): Promise<Result<RawImage>> {
  try {
    const page = await pdf.doc.getPage(pageNumber);
    try {
      const natural = page.getViewport({ scale: 1 });
      const longEdge = Math.max(natural.width, natural.height);
      const scale = Math.min(OCR_BED_PAGE_MAX_EDGE_PX / longEdge, pageRenderScale(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
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
