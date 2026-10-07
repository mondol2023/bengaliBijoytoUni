/**
 * Lists the images a Word document uses, in the order it uses them, with
 * their size and a content hash — read from file headers, without decoding —
 * and decodes a chosen one on demand.
 *
 * Only images `word/document.xml` references are listed (headers, footers and
 * orphaned media are not body content). Order is document order, not the
 * order of the media folder: Word numbers media by insertion, not position.
 * A picture used twice is listed twice with one hash, for
 * `planUnplacedImages` to collapse.
 */
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import { OCR_MAX_FILE_BYTES, OCR_MAX_ITEM_PIXELS } from "../config";
import type { ImageInfo, RawImage } from "../types";
import type { CanvasEnv } from "./canvas";
import { readImageSize } from "./imageSize";
import { hashBytes } from "./pixels";

export interface DocxImage extends ImageInfo {
  /** Part name relative to `word/`, e.g. `media/image1.png`. */
  name: string;
  mime: string;
  /** The encoded file (small); decode with `decodeDocxImage`. */
  bytes: Uint8Array;
}

export interface DocxScan {
  images: DocxImage[];
  /** Uses of an image that could not be read: unsupported format, corrupt, missing, or oversize. */
  unreadable: number;
}

function invalid(message: string, reason: "corrupted" | "unsupported_format" | "too_large", cause?: unknown) {
  return err(AppErrors.fileProcessing(message, { details: { fileType: "docx", reason }, debug: cause }));
}

/** `<a:blip r:embed>` (DrawingML) and `<v:imagedata r:id>` (legacy VML) — the relationship ids pictures use. */
const IMAGE_REFERENCE = /<(?:a:blip|v:imagedata)\b[^>]*?\br:(?:embed|id)="([^"]+)"/g;

function parseRelationships(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const tag of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
    const attributes = new Map<string, string>();
    for (const [, key, value] of tag.matchAll(/\b(Id|Target|TargetMode)="([^"]*)"/g)) attributes.set(key, value);
    const id = attributes.get("Id");
    const target = attributes.get("Target");
    if (id && target && attributes.get("TargetMode") !== "External") targets.set(id, target);
  }
  return targets;
}

/** Resolves a relationship target (relative to `word/`, or absolute) to a part name in the package. */
function resolvePart(target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `word/${target}`).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

export async function listDocxImages(data: Uint8Array): Promise<Result<DocxScan>> {
  if (data.byteLength > OCR_MAX_FILE_BYTES) {
    return invalid(`File is too large — the maximum size is ${Math.round(OCR_MAX_FILE_BYTES / (1024 * 1024))}MB.`, "too_large");
  }

  const { default: JSZip } = await import("jszip");
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (cause) {
    return invalid("Could not read this document — it may be corrupted.", "corrupted", cause);
  }

  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (documentXml === undefined) {
    return invalid("This does not look like a Word (.docx) document.", "unsupported_format");
  }
  const relationships = zip.file("word/_rels/document.xml.rels");
  const targets = relationships ? parseRelationships(await relationships.async("string")) : new Map<string, string>();

  const images: DocxImage[] = [];
  let unreadable = 0;
  const decoded = new Map<string, DocxImage | null>();

  for (const [, id] of documentXml.matchAll(IMAGE_REFERENCE)) {
    const target = targets.get(id);
    if (!target) continue; // linked (external) or dangling: nothing in the file to read

    const part = resolvePart(target);
    if (!decoded.has(part)) decoded.set(part, await readImagePart(zip, part));
    const image = decoded.get(part);
    if (image) images.push(image);
    else unreadable++;
  }

  return ok({ images, unreadable });
}

async function readImagePart(
  zip: { file(name: string): { async(type: "uint8array"): Promise<Uint8Array> } | null },
  part: string,
): Promise<DocxImage | null> {
  const entry = zip.file(part);
  if (!entry) return null;

  // A small zip can inflate to gigabytes. JSZip records each entry's real size in its central
  // directory entry; refuse to inflate anything past the upload cap. (Internal field — absent
  // means "unknown", in which case the header checks below still apply.)
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === "number" && declared > OCR_MAX_FILE_BYTES) return null;

  const bytes = await entry.async("uint8array");
  const size = readImageSize(bytes);
  if (!size || !(size.width > 0 && size.height > 0) || size.width * size.height > OCR_MAX_ITEM_PIXELS) return null;

  return {
    name: part.startsWith("word/") ? part.slice("word/".length) : part,
    mime: size.mime,
    bytes,
    pxWidth: size.width,
    pxHeight: size.height,
    hash: hashBytes(bytes, size.mime),
  };
}

/** Decodes a listed image to RGBA pixels, one at a time, so a large document never holds them all. */
export async function decodeDocxImage(
  image: DocxImage,
  env: Pick<CanvasEnv, "decodeImage">,
): Promise<Result<RawImage>> {
  const decoded = await env.decodeImage(image.bytes, image.mime);
  if (!decoded) return invalid(`Could not read the image ${image.name} in this document.`, "corrupted");
  return ok(decoded);
}
