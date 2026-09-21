import { AppErrors } from "@/lib/errors/types";
import type { FileProcessingError } from "@/lib/errors/types";
import { MAX_UPLOAD_SIZE_BYTES } from "./config";

/**
 * Size checks that have to happen *before* an upload is materialized in
 * memory.
 *
 * `extractDocumentText` already rejects an oversize file, but it only sees a
 * `Buffer` — by the time it can say no, the whole upload has been read into
 * the process. On routes reachable without signing in, that inverts the
 * point of the cap: a caller can make the server allocate an arbitrary
 * amount of memory and only then be told the limit is 15MB. These two
 * guards move the same decision earlier, to the two points where the size is
 * known but the bytes have not been copied yet.
 *
 * The buffer-level check in `extractDocumentText` stays — it's that
 * function's own invariant and it has callers besides these routes.
 */

function tooLarge(fileName: string | undefined, maxSizeBytes: number): FileProcessingError {
  return AppErrors.fileProcessing(
    `File is too large — the maximum upload size is ${Math.round(maxSizeBytes / (1024 * 1024))}MB.`,
    { details: { fileName, reason: "too_large" } },
  );
}

/**
 * Rejects on the declared `Content-Length` before `request.formData()` runs,
 * which is the point that actually buffers the body. The header is absent on
 * a chunked request and is attacker-controlled either way, so this is an
 * early-out that saves work in the common case, not the only line of
 * defense — `rejectOversizeFile` below still runs on the parsed file.
 *
 * The allowance over `maxSizeBytes` covers multipart framing (boundaries,
 * part headers) so a file exactly at the limit isn't rejected for its
 * envelope.
 */
export function rejectOversizeRequest(
  request: Request,
  maxSizeBytes: number = MAX_UPLOAD_SIZE_BYTES,
): FileProcessingError | null {
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) return null;
  const allowance = 16 * 1024;
  return declared > maxSizeBytes + allowance ? tooLarge(undefined, maxSizeBytes) : null;
}

/** Rejects on `File.size` before `file.arrayBuffer()` copies the bytes into a Buffer. */
export function rejectOversizeFile(
  file: File,
  maxSizeBytes: number = MAX_UPLOAD_SIZE_BYTES,
): FileProcessingError | null {
  return file.size > maxSizeBytes ? tooLarge(file.name, maxSizeBytes) : null;
}
