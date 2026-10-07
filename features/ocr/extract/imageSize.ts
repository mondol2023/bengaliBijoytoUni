/**
 * Image dimensions read from the file header alone — no decoding. DOCX
 * images are filtered by size *before* any pixels are decoded, so a hostile
 * 60000 × 60000 PNG is refused without allocating it.
 */

export interface ImageSize {
  width: number;
  height: number;
  mime: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

/** Size and MIME type of a PNG, GIF, BMP or JPEG, or null for anything else or a truncated header. */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (startsWith(bytes, PNG_SIGNATURE)) {
    if (bytes.length < 24) return null;
    return { width: view.getUint32(16), height: view.getUint32(20), mime: "image/png" };
  }

  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    if (bytes.length < 10) return null;
    return { width: view.getUint16(6, true), height: view.getUint16(8, true), mime: "image/gif" };
  }

  if (startsWith(bytes, [0x42, 0x4d])) {
    if (bytes.length < 26) return null;
    if (view.getUint32(14, true) === 12) {
      // OS/2 core header: unsigned 16-bit fields.
      return { width: view.getUint16(18, true), height: view.getUint16(20, true), mime: "image/bmp" };
    }
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)), mime: "image/bmp" };
  }

  if (startsWith(bytes, [0xff, 0xd8])) return readJpegSize(bytes, view);

  return null;
}

function readJpegSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++; // fill byte
      continue;
    }
    // Start-of-frame markers carry the size; C4 (DHT), C8 (JPG) and CC (DAC) are not frames.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 9 > bytes.length) return null;
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5), mime: "image/jpeg" };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}
