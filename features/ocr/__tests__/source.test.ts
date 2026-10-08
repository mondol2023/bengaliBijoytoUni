import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { detectOcrFileKind } from "../job/fileKind";
import { isModeAvailable, prepareOcrSource, type OcrFileKind, type OcrSource } from "../job/source";
import type { PdfjsLoader } from "../extract/openPdf";
import type { OcrMode } from "../types";
import { nodeCanvasEnv, solidPng } from "./helpers/nodeCanvas";
import { buildPdf, patternRgb, type FixtureImage } from "./helpers/pdfFixture";

const loader: PdfjsLoader = () => import("pdfjs-dist/legacy/build/pdf.mjs") as ReturnType<PdfjsLoader>;
const deps = { canvas: nodeCanvasEnv, pdf: { loader } };
const PAGE = { width: 612, height: 792 };

const enc = (s: string) => new TextEncoder().encode(s);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 120 x 90 px fragment whose pixels depend on `seed`, so each seed hashes differently. */
const fragment = (seed: number): FixtureImage =>
  patternRgb(120, 90, (x, y) => [(x * 3 + seed * 40) % 256, (y * 5 + seed * 17) % 256, (x + y + seed) % 256]);

const images = { A: fragment(1), B: fragment(2), C: fragment(3), D: fragment(4), E: fragment(5), F: fragment(6), G: fragment(7) };
// Each fragment is drawn 100 x 30 pt, 10 pt apart, so a row is 320 pt wide.
const draw = (name: string, x: number, y: number) => `q 100 0 0 30 ${x} ${y} cm /${name} Do Q`;
const row = (names: string[], y: number) => names.map((n, i) => draw(n, 50 + i * 110, y)).join(" ");

/** Page 1: two rows. Page 2: one row whose first fragment repeats page 1's first fragment at the same spot. */
const embeddedPdf = () =>
  buildPdf(
    [
      { ...PAGE, content: `${row(["A", "B", "C"], 700)} ${row(["D", "E", "F"], 600)}` },
      { ...PAGE, content: row(["A", "G", "E"], 700) },
    ],
    images,
  );

async function prepare(bytes: Uint8Array, kind: OcrFileKind, mode: OcrMode): Promise<OcrSource> {
  const result = await prepareOcrSource(bytes, kind, mode, deps);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function docx(entries: Array<{ id: string; bytes: Uint8Array }>): Promise<Uint8Array> {
  const zip = new JSZip();
  const body = entries
    .map((e) => `<w:p><w:r><w:drawing><a:blip r:embed="${e.id}"/></w:drawing></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r" xmlns:a="a"><w:body>${body}</w:body></w:document>`,
  );
  const rels = entries
    .map((e) => `<Relationship Id="${e.id}" Type="image" Target="media/${e.id}.png"/>`)
    .join("");
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships>${rels}</Relationships>`);
  for (const e of entries) zip.file(`word/media/${e.id}.png`, e.bytes);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("detectOcrFileKind", () => {
  it("recognises a PDF by its magic bytes", () => {
    expect(detectOcrFileKind("a.pdf", enc("%PDF-1.7\n"))).toEqual({ ok: true, value: "pdf" });
  });

  it("recognises a zip container as docx", () => {
    const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]);
    expect(detectOcrFileKind("a.docx", head)).toEqual({ ok: true, value: "docx" });
  });

  it("trusts the bytes over the extension", () => {
    expect(detectOcrFileKind("renamed.txt", enc("%PDF-1.4"))).toEqual({ ok: true, value: "pdf" });
  });

  it("rejects a PNG named .pdf as unsupported", () => {
    const result = detectOcrFileKind("scan.pdf", PNG_HEAD);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ reason: "unsupported_format" });
    expect(result.error.message).toContain("PDF or Word");
  });

  it("rejects an empty head", () => {
    const result = detectOcrFileKind("x.docx", new Uint8Array());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ reason: "unsupported_format" });
  });
});

describe("prepareOcrSource (PDF, embedded)", () => {
  it("plans rows in page order with boxes, page sizes and a stitched first row", async () => {
    const source = await prepare(embeddedPdf(), "pdf", "embedded");
    try {
      expect(source.kind).toBe("pdf");
      expect(source.mode).toBe("embedded");
      expect(source.items.map((i) => i.label)).toEqual(["Page 1 · line 1", "Page 1 · line 2", "Page 2 · line 1"]);
      expect(source.items.map((i) => i.id)).toEqual(["p1-r1", "p1-r2", "p2-r1"]);
      expect(source.items.every((i) => i.box !== null && i.page !== null)).toBe(true);
      expect(source.skipped.duplicate).toBeGreaterThanOrEqual(1);
      expect(source.pages).toHaveLength(2);
      expect(source.pages[0]).toEqual({ page: 1, widthPt: 612, heightPt: 792 });
      expect(source.renderPagePreview).not.toBeNull();

      const first = await source.items[0].load();
      expect(first).not.toBeNull();
      // 320 pt wide at 3 px/pt (the sharpest fragment's density).
      expect(first!.width).toBe(960);
      expect(first!.data).toHaveLength(first!.width * first!.height * 4);
    } finally {
      await source.dispose();
    }
  });

  it("renders a low-resolution page preview within the bed edge", async () => {
    const source = await prepare(embeddedPdf(), "pdf", "embedded");
    try {
      const preview = await source.renderPagePreview!(1);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(Math.max(preview.value.width, preview.value.height)).toBeLessThanOrEqual(900);
      expect(preview.value.height).toBeGreaterThan(preview.value.width);
    } finally {
      await source.dispose();
    }
  });

  it("returns ok with no items for a PDF that has no images", async () => {
    const source = await prepare(buildPdf([{ ...PAGE, content: "" }]), "pdf", "embedded");
    expect(source.items).toEqual([]);
    expect(source.pages).toHaveLength(1);
    await source.dispose();
  });
});

describe("prepareOcrSource (PDF, pages)", () => {
  it("makes one item per page with no box", async () => {
    const source = await prepare(embeddedPdf(), "pdf", "pages");
    try {
      expect(source.items.map((i) => i.label)).toEqual(["Page 1", "Page 2"]);
      expect(source.items.map((i) => i.id)).toEqual(["page-1", "page-2"]);
      expect(source.items.every((i) => i.box === null)).toBe(true);
      expect(source.pages).toHaveLength(2);
      const page = await source.items[1].load();
      expect(page).not.toBeNull();
      expect(page!.width).toBeGreaterThan(0);
    } finally {
      await source.dispose();
    }
  });
});

describe("prepareOcrSource (DOCX)", () => {
  const bytes = () =>
    docx([
      { id: "rId1", bytes: solidPng(200, 120, [255, 0, 0]) },
      { id: "rId2", bytes: solidPng(16, 16, [0, 255, 0]) },
      { id: "rId3", bytes: solidPng(220, 130, [0, 0, 255]) },
    ]);

  it("lists readable images in document order, dropping decorative ones", async () => {
    const source = await prepare(await bytes(), "docx", "embedded");
    try {
      expect(source.items.map((i) => i.label)).toEqual(["Image 1", "Image 2"]);
      expect(source.items.map((i) => i.id)).toEqual(["img-1", "img-2"]);
      expect(source.items.every((i) => i.page === null && i.box === null)).toBe(true);
      expect(source.pages).toEqual([]);
      expect(source.renderPagePreview).toBeNull();
      expect(source.skipped.decorative).toBe(1);
      expect(await source.items[0].load()).toMatchObject({ width: 200, height: 120 });
    } finally {
      await source.dispose();
    }
  });

  it("does not offer Whole pages mode", async () => {
    expect(isModeAvailable("docx", "pages")).toBe(false);
    expect(isModeAvailable("docx", "embedded")).toBe(true);
    expect(isModeAvailable("pdf", "pages")).toBe(true);
    const result = await prepareOcrSource(await bytes(), "docx", "pages", deps);
    expect(result.ok).toBe(false);
  });

  it("rejects a zip that is not a Word document", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    const zipped = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    const result = await prepareOcrSource(zipped, "docx", "embedded", deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ reason: "unsupported_format" });
  });
});

describe("dispose", () => {
  it("can be called twice", async () => {
    const source = await prepare(embeddedPdf(), "pdf", "embedded");
    await source.dispose();
    await expect(source.dispose()).resolves.toBeUndefined();
  });
});
