import type { Token } from "../encodings/types";

/** Joins reordered tokens into a single string, prior to normalization. */
export function assembleText(tokens: Token[]): string {
  return tokens.map((token) => token.unicode).join("");
}

/**
 * Applies Unicode Normalization Form C. This is the single normalization
 * implementation shared by both the text-input and document-extraction
 * paths (see `features/documents`), so there is exactly one definition of
 * "normalized" across the app.
 */
export function normalizeText(text: string): string {
  return text.normalize("NFC");
}
