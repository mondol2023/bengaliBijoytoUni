import type { SupportedFileFormat } from "@/types/domain";

export const MAX_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

const EXTENSION_FORMAT: Record<string, SupportedFileFormat> = {
  pdf: "pdf",
  docx: "docx",
  doc: "doc",
  txt: "txt",
};

const MIME_FORMAT: Record<string, SupportedFileFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "text/plain": "txt",
};

export const ACCEPTED_FILE_EXTENSIONS = Object.keys(EXTENSION_FORMAT).map((ext) => `.${ext}`);

/** Reverse of `MIME_FORMAT` — used when re-uploading an already-classified file to Storage. */
export const FORMAT_MIME: Record<SupportedFileFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
};

/**
 * File extension is the source of truth for format detection — browsers
 * frequently send an empty or generic (`application/octet-stream`) MIME type
 * for `.doc`/`.docx` uploads. MIME is only a fallback for extension-less or
 * unrecognized-extension files.
 */
export function resolveFileFormat(fileName: string, mimeType: string): SupportedFileFormat | undefined {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension && extension in EXTENSION_FORMAT) {
    return EXTENSION_FORMAT[extension];
  }
  return MIME_FORMAT[mimeType];
}
