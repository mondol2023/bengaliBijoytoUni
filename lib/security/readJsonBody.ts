/**
 * Read a JSON request body with a byte ceiling.
 *
 * `await request.json()` buffers whatever arrives before anything validates
 * it, so a zod schema — however tight — is enforced only after the whole
 * payload is already in memory. On a route open to anonymous callers that
 * makes the schema's per-field `.max()` bounds a description of the accepted
 * shape rather than a bound on what the process will hold.
 *
 * The ceiling is applied twice, because either check alone has a hole:
 *
 * - `Content-Length`, when present, rejects before a single byte is read.
 *   It is client-supplied and therefore not trustworthy on its own, but a
 *   *lie* about it is caught by the second check.
 * - Streaming the body with a running byte count catches a chunked request
 *   that sends no length, and an honest-looking header followed by more
 *   bytes. Reading stops at the ceiling rather than after it.
 *
 * Returns a discriminated union rather than throwing, matching the
 * `Result`-shaped error handling the routes already use.
 */
import { AppErrors } from "@/lib/errors/types";
import type { AppError } from "@/lib/errors/types";

/**
 * 512 KiB, against a worst legitimate case of roughly 320 KB.
 *
 * `POST /api/conversion-failures` accepts at most
 * `maxFailuresPerReport` (50) entries, each with about 2,100 code units
 * across its string fields. A code unit is at most 3 UTF-8 bytes (a 4-byte
 * character costs two code units, so it cannot exceed that ratio), giving
 * ~315 KB of field content plus JSON punctuation and key names. 512 KiB
 * leaves headroom without being a number a legitimate client can reach.
 */
export const MAX_JSON_BODY_BYTES = 512 * 1024;

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; error: AppError };

function tooLarge(maxBytes: number): JsonBodyResult {
  return {
    ok: false,
    // 413. Deliberately states the limit: a legitimate client that hits this
    // has a bug worth telling it about, and the number is not a secret —
    // it is derivable from the schema bounds already public in the 400s.
    error: AppErrors.limitExceeded(`Request body must be at most ${maxBytes} bytes.`),
  };
}

export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    // A malformed header is not treated as a rejection: the streaming pass
    // below is the authority, and refusing on an unparseable value would
    // turn a proxy quirk into a broken route.
    if (Number.isFinite(length) && length > maxBytes) return tooLarge(maxBytes);
  }

  const body = request.body;
  let text: string;

  if (body === null) {
    // No stream to meter — some runtimes and most test doubles give a body
    // only through `.text()`. The content-length check above still applied,
    // and the length check below catches the rest.
    text = await request.text();
    // `.length` is code units; a byte count needs the encoder. Worth the
    // pass: this branch is exactly the one with no streaming ceiling.
    if (new TextEncoder().encode(text).byteLength > maxBytes) return tooLarge(maxBytes);
  } else {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          // Stop pulling. Without this the sender keeps streaming into a
          // buffer we have already decided to discard.
          await reader.cancel().catch(() => {});
          return tooLarge(maxBytes);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    text = new TextDecoder().decode(joined);
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: AppErrors.validation("Expected a JSON body.") };
  }
}
