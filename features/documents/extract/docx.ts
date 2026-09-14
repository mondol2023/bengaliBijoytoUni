import mammoth from "mammoth";
import { AppErrors, err, ok, type Result } from "@/lib/errors/types";
import type { ExtractedDocument } from "./types";

/**
 * Extracts raw text from a `.docx` via `mammoth`. Runs server-only — never
 * import this from a client component.
 */
export async function extractDocxText(buffer: Buffer, fileName: string): Promise<Result<ExtractedDocument>> {
  let value: string;
  let messages: { type: string; message: string }[];
  try {
    ({ value, messages } = await mammoth.extractRawText({ buffer }));
  } catch (cause) {
    return err(
      AppErrors.fileProcessing("Could not read this .docx file — it may be corrupted.", {
        details: { fileName, fileType: "docx", reason: "corrupted" },
        debug: cause,
      }),
    );
  }

  if (value.trim().length === 0) {
    return err(
      AppErrors.fileProcessing("This document has no extractable text.", {
        details: { fileName, fileType: "docx", reason: "empty" },
      }),
    );
  }

  const notes = messages.filter((message) => message.type === "warning").map((message) => message.message);

  return ok({ text: value, fileName, fileType: "docx", notes: notes.length > 0 ? notes : undefined });
}
