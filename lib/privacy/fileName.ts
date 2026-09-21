/**
 * Reduces a user's file name to the only part of it we are willing to store.
 *
 * A file name is user content. `q3-layoffs-draft.docx` discloses something
 * even when the text inside the document never leaves the browser, and it was
 * previously written verbatim onto every diagnostic row produced by a
 * document upload. Nothing downstream of those rows reads the name: the admin
 * triage UI groups by failed sequence, and the only file attribute any
 * diagnosis has ever used is the format. So the name is dropped at the
 * boundary and the extension is kept.
 *
 * This module is the single definition of that bound, imported by both
 * diagnostic writers (`lib/conversionFailures/occurrence.ts` for
 * `conversionFailures`, `lib/firebase/errorLog.ts` for `errorLogs`). It is
 * deliberately dependency-free and browser-safe — one of its two callers is
 * bundled into the client.
 *
 * Out of scope on purpose: `lib/firebase/recordActivity.ts#recordDocumentUpload`
 * keeps the real name. That is a signed-in user's own document history, where
 * the name is the feature; it is disclosed separately and is what the delete
 * control exists for.
 */

/**
 * The longest run of characters after the final dot still treated as an
 * extension. Real ones are short; anything longer is either not an extension
 * or is a caller trying to smuggle the name back in past this function.
 */
const MAX_EXTENSION_LENGTH = 16;

/** Extensions are stored lowercase and alphanumeric, or not at all. */
const EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/;

/**
 * `"report.docx"` → `".docx"`. Returns null for anything that is not a plain
 * alphanumeric extension, including a bare name, a dotfile (`.gitignore` is
 * a name, not an extension), a trailing dot, and any extension carrying
 * characters a real one does not have.
 *
 * Leading path segments are stripped before the dot is looked for, because
 * this also runs on client-supplied values at the API boundary, where the
 * input is whatever the caller chose to send rather than a `File.name`.
 */
export function fileExtensionOnly(fileName: string | null | undefined): string | null {
  if (!fileName) return null;

  const base = fileName.split(/[\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  // `dot <= 0` covers both "no dot at all" and a leading-dot name, where the
  // whole thing is the file's name rather than its type.
  if (dot <= 0 || dot === base.length - 1) return null;

  const extension = base.slice(dot + 1).toLowerCase();
  if (extension.length > MAX_EXTENSION_LENGTH) return null;
  if (!EXTENSION_PATTERN.test(extension)) return null;

  return `.${extension}`;
}
