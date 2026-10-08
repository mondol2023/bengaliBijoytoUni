/**
 * Bounds for the OCR page's AI fallback, shared by the route (which enforces
 * them) and the browser (which sizes its uploads to fit). Kept free of server
 * imports for that reason.
 *
 * All *provisional*: they come from the Phase 0 spike (`docs/ocr-extraction-plan.md`
 * §11) and from Vercel's ~4.5MB function body limit, not from measurement of
 * real traffic. Revisit after the Phase 5 live check.
 */
export const OCR_AI_LIMITS = {
  /** Crops per provider call. Gemini took 8–14s per single line in the spike, so a small batch keeps a call inside the timeout. */
  maxImagesPerRequest: 4,
  /** One encoded crop. A 2000px JPEG strip is far below this; a photographed page is the case it exists for. */
  maxImageBytes: 1_500_000,
  /** Whole request body, under Vercel's ~4.5MB limit with room for multipart framing. */
  maxRequestBytes: 3_800_000,
  /** Most crops sent for one job; the rest stay with their local reading and can be improved one by one. */
  maxImagesPerJob: 40,
  /** Longest edge of an uploaded crop, in pixels. */
  maxEdgePx: 2000,
  jpegQuality: 0.85,
  /** Per provider call. Two providers must fit inside the route's `maxDuration`. */
  providerTimeoutMs: 25_000,
  /** One whole-page photo of dense Bengali is a few thousand characters. */
  maxTextChars: 20_000,
  /** Per signed-in caller. A job of 40 crops is ten requests. */
  rateLimit: { limit: 12, windowMs: 10 * 60_000 },
} as const;
