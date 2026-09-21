import { AppErrors, ok, err, type AppError, type Result } from "@/lib/errors/types";
import { getEncoding } from "../encodings/registry";
import { tokenize } from "./tokenize";
import { hasDanglingPreBaseVowel, reorderTokens } from "./reorder";
import { assembleText, normalizeText, stripBom } from "./normalize";
import {
  ALREADY_UNICODE_MESSAGE,
  detectAlreadyUnicode,
  validateTokens,
  validateUnicodeOutput,
  type ValidationResult,
} from "./validate";
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
  // Checked before reordering: this asks whether the *input* ended
  // mid-cluster, which is what `reorderTokens` then leaves pending.
  const incompleteCluster = hasDanglingPreBaseVowel(tokens);
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
  const outputValidation = validateUnicodeOutput(unicodeText, { incompleteCluster });
  const validation: ValidationResult = {
    valid: tokenValidation.valid && outputValidation.valid,
    warnings: [...tokenValidation.warnings, ...outputValidation.warnings],
    unmappedSequences: tokenValidation.unmappedSequences,
    unmappedDetails: tokenValidation.unmappedDetails,
    alreadyUnicode: false,
  };

  // E4. Text that is already Unicode Bengali matches no rule in a CP1252
  // table, so every Bengali letter came back as an "unmapped character":
  // ~18 warnings and ~18 unfixable `failurePatterns` rows from one ordinary
  // paste. It is not a conversion failure, it is a no-op, so it reports as
  // one — a single explanatory message, and `valid: true` so neither
  // `useIssueLog` (which logs only when `!valid`) nor the failure reporter
  // (which reads `unmappedDetails`) records anything.
  if (detectAlreadyUnicode(sourceText)) {
    return ok({
      encodingId: encoding.id,
      sourceText,
      unicodeText,
      validation: {
        valid: true,
        warnings: [ALREADY_UNICODE_MESSAGE],
        unmappedSequences: [],
        unmappedDetails: [],
        alreadyUnicode: true,
      },
      engineVersion: CONVERSION_ENGINE_VERSION,
      rulesHash: computeRulesHash(encoding),
    });
  }

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
export { detectAlreadyUnicode, ALREADY_UNICODE_MESSAGE } from "./validate";
export { validateUnicodeOutput, formatUnmappedDetail, formatUnmappedDetails } from "./validate";
export type { ValidationResult, UnmappedDetail } from "./validate";
export type { DetectionResult, EncodingScore } from "./detectEncoding";
export { CONVERSION_ENGINE_VERSION, computeRulesHash } from "./version";
export { FAILURE_CATEGORIES, classifyValidationWarning, classifyAppErrorCode } from "./classify";
export type { FailureCategory } from "./classify";
