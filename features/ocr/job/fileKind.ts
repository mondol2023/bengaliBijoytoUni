import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";

import type { OcrMode } from "../types";

export type OcrFileKind = "pdf" | "docx";

/**
 * Whole-page mode needs pages to render, which a Word document does not have.
 * Lives here, not in `source.ts`, so the mode toggle can ask without pulling
 * the pdf.js and JSZip extraction modules into the page's first load.
 */
export function isModeAvailable(kind: OcrFileKind, mode: OcrMode): boolean {
  return !(kind === "docx" && mode === "pages");
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

function startsWith(head: Uint8Array, magic: readonly number[]): boolean {
  return head.length >= magic.length && magic.every((byte, i) => head[i] === byte);
}

/**
 * Decides what a file is from its first bytes, never its name: a PNG renamed
 * `.pdf` must not reach pdf.js. A zip is only provisionally a Word document;
 * `listDocxImages` confirms it when it finds `word/document.xml`. The name
 * only chooses which error wording the user sees.
 */
export function detectOcrFileKind(name: string, head: Uint8Array): Result<OcrFileKind> {
  if (startsWith(head, PDF_MAGIC)) return ok("pdf");
  if (startsWith(head, ZIP_MAGIC)) return ok("docx");

  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const message =
    extension === "pdf" || extension === "docx"
      ? `This file is named .${extension} but is not really a PDF or Word (.docx) document. Check the file and try again.`
      : "Text recognition reads PDF or Word (.docx) files only.";
  return err(AppErrors.fileProcessing(message, { details: { fileName: name, reason: "unsupported_format" } }));
}
