import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { OCR_MAX_FILE_BYTES } from "../config";
import { decodeDocxImage, listDocxImages } from "../extract/docxImages";
import { planUnplacedImages } from "../extract/filter";
import { nodeCanvasEnv, solidPng } from "./helpers/nodeCanvas";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

const drawing = (rid: string) =>
  `<w:p><w:r><w:drawing><a:graphic><a:graphicData><pic:pic xmlns:pic="x"><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing></w:r></w:p>`;
const vml = (rid: string) => `<w:p><w:r><w:pict><v:shape><v:imagedata r:id="${rid}" o:title=""/></v:shape></w:pict></w:r></w:p>`;

interface Part {
  id: string;
  target: string;
  /** Bytes under word/ (the target is relative to word/). */
  bytes?: Uint8Array;
  attrs?: string;
}

async function docx(bodyXml: string, parts: Part[], extra: Record<string, Uint8Array | string> = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`);
  const rels = parts
    .map((p) => `<Relationship Id="${p.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${p.target}" ${p.attrs ?? ""}/>`)
    .join("");
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
  for (const p of parts) if (p.bytes) zip.file(`word/${p.target}`, p.bytes);
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

const RED = solidPng(120, 80, [255, 0, 0]);
const BLUE = solidPng(200, 100, [0, 0, 255]);

async function list(bytes: Uint8Array) {
  const result = await listDocxImages(bytes);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("listDocxImages", () => {
  it("returns images in the order the document uses them, not the order of the media folder", async () => {
    const bytes = await docx(drawing("rId2") + drawing("rId1"), [
      { id: "rId1", target: "media/image1.png", bytes: RED },
      { id: "rId2", target: "media/image2.png", bytes: BLUE },
    ]);
    const { images } = await list(bytes);
    expect(images.map((i) => [i.name, i.pxWidth, i.pxHeight, i.mime])).toEqual([
      ["media/image2.png", 200, 100, "image/png"],
      ["media/image1.png", 120, 80, "image/png"],
    ]);
  });

  it("lists an image once per use, with the same hash, so de-duplication can drop the repeat", async () => {
    const bytes = await docx(drawing("rId1") + drawing("rId1"), [{ id: "rId1", target: "media/logo.png", bytes: RED }]);
    const { images } = await list(bytes);
    expect(images).toHaveLength(2);
    expect(images[0].hash).toBe(images[1].hash);
    const planned = planUnplacedImages(images);
    expect(planned.ok && planned.value.items).toHaveLength(1);
  });

  it("gives different images different hashes", async () => {
    const bytes = await docx(drawing("rId1") + drawing("rId2"), [
      { id: "rId1", target: "media/a.png", bytes: RED },
      { id: "rId2", target: "media/b.png", bytes: BLUE },
    ]);
    const { images } = await list(bytes);
    expect(images[0].hash).not.toBe(images[1].hash);
  });

  it("finds legacy VML images (<v:imagedata r:id>) in order with DrawingML ones", async () => {
    const bytes = await docx(vml("rId1") + drawing("rId2"), [
      { id: "rId1", target: "media/old.png", bytes: RED },
      { id: "rId2", target: "media/new.png", bytes: BLUE },
    ]);
    const { images } = await list(bytes);
    expect(images.map((i) => i.name)).toEqual(["media/old.png", "media/new.png"]);
  });

  it("ignores media that document.xml never references (headers, orphaned files)", async () => {
    const bytes = await docx(drawing("rId1"), [{ id: "rId1", target: "media/body.png", bytes: RED }], {
      "word/media/orphan.png": BLUE,
      "word/header1.xml": `<w:hdr ${NS}>${drawing("rId9")}</w:hdr>`,
    });
    const { images } = await list(bytes);
    expect(images.map((i) => i.name)).toEqual(["media/body.png"]);
  });

  it("does not read linked (external) images, and counts formats it cannot decode as unreadable", async () => {
    const bytes = await docx(drawing("rId1") + drawing("rId2") + drawing("rId3"), [
      { id: "rId1", target: "https://example.com/a.png", attrs: 'TargetMode="External"' },
      { id: "rId2", target: "media/chart.emf", bytes: new Uint8Array([1, 2, 3, 4]) },
      { id: "rId3", target: "media/ok.png", bytes: RED },
    ]);
    const { images, unreadable } = await list(bytes);
    expect(images.map((i) => i.name)).toEqual(["media/ok.png"]);
    expect(unreadable).toBe(1);
  });

  it("counts an image whose bytes are not an image of its claimed type as unreadable", async () => {
    const bytes = await docx(drawing("rId1"), [{ id: "rId1", target: "media/bad.png", bytes: new TextEncoder().encode("nope") }]);
    const { images, unreadable } = await list(bytes);
    expect(images).toEqual([]);
    expect(unreadable).toBe(1);
  });

  it("resolves absolute and ../ targets against the package", async () => {
    const bytes = await docx(drawing("rId1") + drawing("rId2"), [
      { id: "rId1", target: "/word/media/abs.png", attrs: "" },
      { id: "rId2", target: "../word/media/up.png", attrs: "" },
    ], { "word/media/abs.png": RED, "word/media/up.png": BLUE });
    const { images } = await list(bytes);
    expect(images.map((i) => i.pxWidth)).toEqual([120, 200]);
  });

  it("does not inflate an image entry larger than the file cap (a zip bomb with a valid PNG header)", async () => {
    // A real PNG header followed by 16 MB of zeros: tiny once deflated, huge once read.
    const header = solidPng(10, 10, [0, 0, 0]).slice(0, 33);
    const bomb = new Uint8Array(OCR_MAX_FILE_BYTES + 1024);
    bomb.set(header);
    const bytes = await docx(drawing("rId1"), [{ id: "rId1", target: "media/bomb.png", bytes: bomb }]);
    expect(bytes.byteLength).toBeLessThan(OCR_MAX_FILE_BYTES / 10);

    const { images, unreadable } = await list(bytes);
    expect(images).toEqual([]);
    expect(unreadable).toBe(1);
  });

  it("returns an empty list for a document with no images", async () => {
    const { images, unreadable } = await list(await docx("<w:p><w:r><w:t>text</w:t></w:r></w:p>", []));
    expect(images).toEqual([]);
    expect(unreadable).toBe(0);
  });

  it("rejects a file that is not a zip, without leaking internals", async () => {
    const result = await listDocxImages(new TextEncoder().encode("not a zip"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
    expect(result.error.message).not.toMatch(/Can't find end of central directory|JSZip/i);
  });

  it("rejects a zip that is not a Word document", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    const result = await listDocxImages(new Uint8Array(await zip.generateAsync({ type: "uint8array" })));
    expect(result.ok).toBe(false);
  });

  it("rejects an oversize file before opening it", async () => {
    const result = await listDocxImages(new Uint8Array(OCR_MAX_FILE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ reason: "too_large" });
  });
});

describe("decodeDocxImage", () => {
  it("decodes a listed image to RGBA pixels", async () => {
    const { images } = await list(await docx(drawing("rId1"), [{ id: "rId1", target: "media/a.png", bytes: RED }]));
    const result = await decodeDocxImage(images[0], nodeCanvasEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.value.width, result.value.height]).toEqual([120, 80]);
    expect(Array.from(result.value.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("reports a user-safe error when the environment cannot decode it", async () => {
    const { images } = await list(await docx(drawing("rId1"), [{ id: "rId1", target: "media/a.png", bytes: RED }]));
    const result = await decodeDocxImage(images[0], { decodeImage: async () => null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
  });
});
