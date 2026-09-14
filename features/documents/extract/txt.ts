import { AppErrors, err, ok, type Result } from "@/lib/errors/types";
import type { ExtractedDocument } from "./types";

const BOM_CHAR_CODE = 0xfeff;

/** Strips a leading UTF-8 BOM, common in text files exported from Windows editors. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === BOM_CHAR_CODE ? text.slice(1) : text;
}

/**
 * Plain-text extraction. Legacy Bijoy/SutonnyMJ `.txt` exports remap ASCII
 * code points visually rather than using multi-byte Unicode, so a lossless
 * UTF-8 decode of the raw bytes reproduces the exact legacy byte sequence
 * the conversion engine expects — no special-case decoding needed. Pure and
 * synchronous, unlike the other extractors, since there's no parsing to do.
 */
export function extractTxtText(buffer: Buffer, fileName: string): Result<ExtractedDocument> {
  const text = stripBom(buffer.toString("utf-8"));

  if (text.trim().length === 0) {
    return err(
      AppErrors.fileProcessing("This file is empty.", {
        details: { fileName, fileType: "txt", reason: "empty" },
      }),
    );
  }

  return ok({ text, fileName, fileType: "txt" });
}
