/**
 * "Load sample" demo strings — one per encoding, used only by the converter
 * UI's sample button. These are deliberately synthetic (not real Bengali
 * sentences): they're built purely from legacy sequences already present in
 * each encoding's provisional rule table, so the demo always converts
 * cleanly and exercises every reorder kind (independent vowel, after-
 * consonant kar, before-consonant kar, hasant conjunct, chandrabindu, reph,
 * digits) without depending on unverified real-world glyph assignments.
 */
export const SAMPLE_TEXT: Record<string, string> = {
  bijoy: "Av Kv wK K&L Ks K© 0123",
  sutonny: "AvB Kv wtK K&L Ku K© 0123",
};
