import WordExtractor from "word-extractor";
import { AppErrors, err, ok, type Result } from "@/lib/errors/types";
import type { ExtractedDocument } from "./types";

const UNRELIABLE_MESSAGE =
  "Legacy .doc extraction isn't reliable enough to trust here — please re-save this file as .docx, .pdf, or .txt and try again.";

/** Above this fraction of replacement/control characters, we don't trust the extraction. */
const UNRELIABLE_THRESHOLD = 0.02;

const REPLACEMENT_CHAR_CODE = 0xfffd;

/** True for the Unicode replacement character or a C0 control code other than tab/CR/LF. */
function isSuspiciousCharCode(code: number): boolean {
  if (code === REPLACEMENT_CHAR_CODE) return true;
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code <= 0x1f;
}

function unreliableRatio(text: string): number {
  if (text.length === 0) return 0;
  let suspicious = 0;
  for (let i = 0; i < text.length; i++) {
    if (isSuspiciousCharCode(text.charCodeAt(i))) suspicious++;
  }
  return suspicious / text.length;
}

/**
 * Best-effort `.doc` (legacy binary Word format) extraction via
 * `word-extractor`. Because binary `.doc` parsing is inherently unreliable,
 * a failed or suspicious-looking extraction returns a typed error pointing
 * the user at a more reliable format instead of silently returning mangled
 * text. Runs server-only — never import this from a client component.
 */
export async function extractDocText(buffer: Buffer, fileName: string): Promise<Result<ExtractedDocument>> {
  let text: string;
  try {
    const extractor = new WordExtractor();
    const document = await extractor.extract(buffer);
    text = document.getBody();
  } catch (cause) {
    return err(
      AppErrors.fileProcessing(UNRELIABLE_MESSAGE, {
        details: { fileName, fileType: "doc", reason: "extraction_failed" },
        debug: cause,
      }),
    );
  }

  if (text.trim().length === 0) {
    return err(
      AppErrors.fileProcessing("This document has no extractable text.", {
        details: { fileName, fileType: "doc", reason: "empty" },
      }),
    );
  }

  if (unreliableRatio(text) > UNRELIABLE_THRESHOLD) {
    return err(
      AppErrors.fileProcessing(UNRELIABLE_MESSAGE, {
        details: { fileName, fileType: "doc", reason: "unreliable_format" },
      }),
    );
  }

  return ok({
    text,
    fileName,
    fileType: "doc",
    notes: ["Legacy .doc extraction is best-effort — double-check the output against the source document."],
  });
}
