import { AppErrors, ok, err, type AppError, type Result } from "@/lib/errors/types";
import { getEncoding } from "../encodings/registry";
import { tokenize } from "./tokenize";
import { reorderTokens } from "./reorder";
import { assembleText, normalizeText, stripBom } from "./normalize";
import { validateTokens, validateUnicodeOutput, type ValidationResult } from "./validate";
import { detectEncoding } from "./detectEncoding";
import { CONVERSION_ENGINE_VERSION, computeRulesHash } from "./version";

export interface ConversionOutput {
  encodingId: string;
  /**
   * The input after source hygiene (currently BOM removal), i.e. the exact
   * string every `sourceIndex`/`position` in `validation` indexes into.
   *
   * Callers that report a failure must window *this*, not the text they
   * passed in: hygiene can shift offsets, and slicing the raw input with a
   * post-hygiene offset yields an off-by-one context window and a wrong
   * stored `position`.
   */
  sourceText: string;
  unicodeText: string;
  validation: ValidationResult;
  /** `CONVERSION_ENGINE_VERSION` at the time of this conversion. */
  engineVersion: string;
  /** Content fingerprint of the encoding's rule table used for this conversion. */
  rulesHash: string;
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
  if (typeof encodingId !== "string" || encodingId.length === 0) {
    return err(
      AppErrors.validation("Select a source encoding before converting.", {
        details: { field: "encodingId" },
      })
    );
  }

  const encoding = getEncoding(encodingId);
  if (!encoding) {
    return err(
      AppErrors.validation(`Unknown encoding "${encodingId}".`, {
        details: { field: "encodingId" },
      })
    );
  }

  // Source hygiene runs before tokenizing so the rest of the pipeline, and
  // every offset it produces, sees one canonical input.
  const sourceText = stripBom(text);

  let tokens = tokenize(sourceText, encoding);
  if (encoding.postProcess) {
    tokens = encoding.postProcess(tokens);
  }
  tokens = reorderTokens(tokens);

  const unicodeText = normalizeText(assembleText(tokens));

  // Two independent checks, merged: `validateTokens` catches sequences the
  // rule table never mapped, `validateUnicodeOutput` catches the final
  // assembled text being malformed regardless of mapping (e.g. a reorder
  // defect leaving a Bengali vowel sign with no base consonant). The output
  // is always NFC-normalized above, so that half of `validateUnicodeOutput`
  // never fires here — this only ever surfaces its reorder-defect check for
  // this call site.
  const tokenValidation = validateTokens(tokens);
  const outputValidation = validateUnicodeOutput(unicodeText);
  const validation: ValidationResult = {
    valid: tokenValidation.valid && outputValidation.valid,
    warnings: [...tokenValidation.warnings, ...outputValidation.warnings],
    unmappedSequences: tokenValidation.unmappedSequences,
    unmappedDetails: tokenValidation.unmappedDetails,
  };

  return ok({
    encodingId: encoding.id,
    sourceText,
    unicodeText,
    validation,
    engineVersion: CONVERSION_ENGINE_VERSION,
    rulesHash: computeRulesHash(encoding),
  });
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

export { detectEncoding, normalizeText, stripBom };
export { validateUnicodeOutput, formatUnmappedDetail, formatUnmappedDetails } from "./validate";
export type { ValidationResult, UnmappedDetail } from "./validate";
export type { DetectionResult, EncodingScore } from "./detectEncoding";
export { CONVERSION_ENGINE_VERSION, computeRulesHash } from "./version";
export { FAILURE_CATEGORIES, classifyValidationWarning, classifyAppErrorCode } from "./classify";
export type { FailureCategory } from "./classify";
