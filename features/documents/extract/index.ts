import { AppErrors, err, type Result } from "@/lib/errors/types";
import { MAX_UPLOAD_SIZE_BYTES, resolveFileFormat } from "../config";
import { extractDocText } from "./doc";
import { extractDocxText } from "./docx";
import { extractPdfText } from "./pdf";
import { extractTxtText } from "./txt";
import type { ExtractedDocument } from "./types";

export type { ExtractedDocument } from "./types";

/**
 * Dispatches to the right format-specific extractor based on the file's
 * name/MIME type (see `resolveFileFormat`), after validating size and
 * format. This is the one entry point the rest of the app should call —
 * runs server-only, never import this from a client component.
 */
export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  /** Admin-configured override (`systemConfig/limits`) — defaults to the hard-coded cap when absent. */
  maxSizeBytesOverride?: number,
): Promise<Result<ExtractedDocument>> {
  const maxSizeBytes = maxSizeBytesOverride ?? MAX_UPLOAD_SIZE_BYTES;

  if (buffer.byteLength === 0) {
    return err(
      AppErrors.fileProcessing("This file is empty.", {
        details: { fileName, reason: "empty" },
      }),
    );
  }

  if (buffer.byteLength > maxSizeBytes) {
    return err(
      AppErrors.fileProcessing(
        `File is too large — the maximum upload size is ${Math.round(maxSizeBytes / (1024 * 1024))}MB.`,
        { details: { fileName, reason: "too_large" } },
      ),
    );
  }

  const format = resolveFileFormat(fileName, mimeType);
  if (!format) {
    return err(
      AppErrors.fileProcessing("Unsupported file type — upload a .pdf, .docx, .doc, or .txt file.", {
        details: { fileName, reason: "unsupported_format" },
      }),
    );
  }

  switch (format) {
    case "pdf":
      return extractPdfText(buffer, fileName);
    case "docx":
      return extractDocxText(buffer, fileName);
    case "doc":
      return extractDocText(buffer, fileName);
    case "txt":
      return extractTxtText(buffer, fileName);
  }
}
