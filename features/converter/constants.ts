/**
 * Plain (non-React) constants shared by client hooks and server route
 * handlers. Kept separate from `hooks/useConversion.ts` (a `"use client"`
 * module) so server-only code — e.g. the document extraction route — never
 * has to import a client hook just to reach this sentinel.
 */

/** Sentinel encoding choice meaning "guess it from the input". */
export const AUTO_DETECT = "auto" as const;
export type EncodingChoice = typeof AUTO_DETECT | string;
