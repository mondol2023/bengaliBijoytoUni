import { AppErrors, ok, err, type AppError, type Result } from "@/lib/errors/types";
import { getEncoding } from "../encodings/registry";
import { tokenize } from "./tokenize";
import { reorderTokens } from "./reorder";
import { assembleText, normalizeText } from "./normalize";
import { validateTokens, type ValidationResult } from "./validate";
import { detectEncoding } from "./detectEncoding";

export interface ConversionOutput {
  encodingId: string;
  unicodeText: string;
  validation: ValidationResult;
}

/**
 * Converts legacy-encoded text to standards-compliant Unicode.
 *
 * Pipeline: tokenize → encoding-specific postProcess → generic reorder pass
 * → assemble → NFC normalize → validate. Each stage is independently
 * unit-testable (see `__tests__/`); this function only wires them together.
 */
export function convertLegacyText(
  text: string,
  encodingId: string
): Result<ConversionOutput, AppError> {
  const encoding = getEncoding(encodingId);
  if (!encoding) {
    return err(
      AppErrors.validation(`Unknown encoding "${encodingId}".`, {
        details: { field: "encodingId" },
      })
    );
  }

  let tokens = tokenize(text, encoding);
  if (encoding.postProcess) {
    tokens = encoding.postProcess(tokens);
  }
  tokens = reorderTokens(tokens);

  const unicodeText = normalizeText(assembleText(tokens));
  const validation = validateTokens(tokens);

  return ok({ encodingId: encoding.id, unicodeText, validation });
}

export interface DocumentConversionInput {
  /** Already-extracted plain text (extraction itself lives in features/documents). */
  extractedText: string;
  encodingId: string;
  fileName?: string;
}

/**
 * Converts text already extracted from an uploaded document. Extraction
 * (PDF/DOCX/DOC/TXT) is deliberately not this function's concern — it lives
 * in `features/documents/extract`, runs server-only, and hands this
 * function plain text through the exact same pipeline as manual text input,
 * so there is exactly one conversion code path regardless of input source.
 */
export function convertDocument(
  input: DocumentConversionInput
): Result<ConversionOutput, AppError> {
  if (input.extractedText.trim().length === 0) {
    return err(
      AppErrors.fileProcessing("The document contained no extractable text.", {
        details: { fileName: input.fileName, reason: "empty" },
      })
    );
  }

  return convertLegacyText(input.extractedText, input.encodingId);
}

export { detectEncoding, normalizeText };
export { validateUnicodeOutput, formatUnmappedDetail, formatUnmappedDetails } from "./validate";
export type { ValidationResult, UnmappedDetail } from "./validate";
export type { DetectionResult, EncodingScore } from "./detectEncoding";
