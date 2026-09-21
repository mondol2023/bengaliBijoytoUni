/**
 * "Load sample" demo strings — one per registered encoding, used only by the
 * converter UI's sample button. Deliberately synthetic (not real Bengali
 * sentences): each is built purely from legacy sequences present in that
 * encoding's rule table, so the demo always converts cleanly and exercises
 * every reorder kind (independent vowel, after-consonant kar,
 * before-consonant kar, hasant conjunct, anusvara, reph, digits) without
 * depending on a glyph assignment that is still converging.
 *
 * All three intentionally produce the *same* Bengali — আ কা কি ক্খ কং র্ক
 * ০১২৩ — which is what makes the demo legible: the reader sees one result
 * reached from three different legacy byte layouts.
 *
 * `__tests__/sampleText.test.ts` asserts every registered encoding has a
 * sample and that each converts with no unmapped sequences, so adding an
 * encoding without a sample fails the suite rather than silently falling
 * back to Bijoy bytes in the UI.
 */

/**
 * Bijoy Classic and SutonnyMJ are one byte layout under two names (see
 * `encodings/sutonny/index.ts`), so they share one sample rather than
 * keeping two that could drift.
 */
const BIJOY_SAMPLE = "Av Kv wK K&L Ks K© 0123";

export const SAMPLE_TEXT: Record<string, string> = {
  bijoy: BIJOY_SAMPLE,
  sutonny: BIJOY_SAMPLE,
  "alpha-ansi": "B L¡ ¢L L&M Lw LÑ 0123",
};
