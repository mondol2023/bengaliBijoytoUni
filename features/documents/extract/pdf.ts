import { extractText, getDocumentProxy } from "unpdf";
import { AppErrors, err, ok, type Result } from "@/lib/errors/types";
import type { ExtractedDocument } from "./types";

/**
 * Extracts merged plain text from a PDF via `unpdf` (a serverless-friendly
 * pdf.js wrapper). Runs server-only — never import this from a client
 * component.
 */
export async function extractPdfText(buffer: Buffer, fileName: string): Promise<Result<ExtractedDocument>> {
  let totalPages: number;
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    ({ totalPages, text } = await extractText(pdf, { mergePages: true }));
  } catch (cause) {
    return err(
      AppErrors.fileProcessing("Could not read this PDF — it may be corrupted or password-protected.", {
        details: { fileName, fileType: "pdf", reason: "corrupted" },
        debug: cause,
      }),
    );
  }

  if (text.trim().length === 0) {
    return err(
      AppErrors.fileProcessing(
        "This PDF has no extractable text — it may be a scanned image without OCR.",
        { details: { fileName, fileType: "pdf", reason: "empty" } },
      ),
    );
  }

  return ok({ text, fileName, fileType: "pdf", pageCount: totalPages });
}
