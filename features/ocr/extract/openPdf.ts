import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import { OCR_MAX_FILE_BYTES, checkPageCap } from "../config";

export type PdfjsModule = typeof import("pdfjs-dist");
export type PdfjsLoader = () => Promise<PdfjsModule>;

/** An opened PDF plus the operator-code table of the pdf.js build that opened it (codes differ between versions). */
export interface OpenPdf {
  doc: PDFDocumentProxy;
  ops: PdfjsModule["OPS"];
  /** Releases the document and its worker. */
  close(): Promise<void>;
}

export interface OpenPdfOptions {
  /** How to load pdf.js. Defaults to a lazy `import("pdfjs-dist")`; tests pass the legacy (Node) build. */
  loader?: PdfjsLoader;
  /** URL of the self-hosted pdf.js worker (browser). Omit to let pdf.js fall back to its in-thread worker. */
  workerSrc?: string;
  /** Extra `getDocument` options, e.g. `wasmUrl` for the self-hosted decoders. */
  documentOptions?: Record<string, unknown>;
}

const defaultLoader: PdfjsLoader = () => import("pdfjs-dist");

/**
 * Opens a PDF for OCR extraction, enforcing the file-size and page caps.
 * Loads pdf.js lazily, so nothing is added to a bundle until a job starts.
 *
 * Takes ownership of `data`: in the browser pdf.js transfers the buffer to its
 * worker, which detaches it. Call `close()` when finished.
 */
export async function openPdf(data: Uint8Array, options: OpenPdfOptions = {}): Promise<Result<OpenPdf>> {
  if (data.byteLength > OCR_MAX_FILE_BYTES) {
    return err(
      AppErrors.fileProcessing(
        `File is too large — the maximum size is ${Math.round(OCR_MAX_FILE_BYTES / (1024 * 1024))}MB.`,
        { details: { fileType: "pdf", reason: "too_large" } },
      ),
    );
  }

  let doc: PDFDocumentProxy;
  let lib: PdfjsModule;
  let task: PDFDocumentLoadingTask;
  try {
    lib = await (options.loader ?? defaultLoader)();
    if (options.workerSrc) lib.GlobalWorkerOptions.workerSrc = options.workerSrc;
    task = lib.getDocument({
      data,
      verbosity: 0,
      ...options.documentOptions,
    });
    doc = await task.promise;
  } catch (cause) {
    const passwordProtected = typeof cause === "object" && cause !== null && (cause as { name?: string }).name === "PasswordException";
    return err(
      AppErrors.fileProcessing(
        passwordProtected
          ? "This PDF is password-protected. Remove the password and try again."
          : "Could not read this PDF — it may be corrupted.",
        { details: { fileType: "pdf", reason: passwordProtected ? "unsupported_format" : "corrupted" }, debug: cause },
      ),
    );
  }

  const capped = checkPageCap(doc.numPages);
  if (!capped.ok) {
    await task.destroy();
    return err(capped.error);
  }
  return ok({ doc, ops: lib.OPS, close: () => task.destroy() });
}
