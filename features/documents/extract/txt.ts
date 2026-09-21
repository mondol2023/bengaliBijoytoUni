import { AppErrors, err, ok, type Result } from "@/lib/errors/types";
import { stripBom } from "@/features/converter/engine/normalize";
import type { ExtractedDocument } from "./types";

/**
 * Plain-text extraction. Legacy Bijoy/SutonnyMJ `.txt` exports remap ASCII
 * code points visually rather than using multi-byte Unicode, so a lossless
 * UTF-8 decode of the raw bytes reproduces the exact legacy byte sequence
 * the conversion engine expects — no special-case decoding needed. Pure and
 * synchronous, unlike the other extractors, since there's no parsing to do.
 */
export function extractTxtText(buffer: Buffer, fileName: string): Result<ExtractedDocument> {
  // Shares the engine's BOM rule rather than keeping a second copy — the
  // conversion pipeline applies the same strip to pasted text.
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
