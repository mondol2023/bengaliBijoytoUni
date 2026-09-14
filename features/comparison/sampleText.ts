/**
 * Built-in example pair for the compare page's "Load example" action — gives
 * the diff viewer something to show immediately instead of an empty state,
 * the same role `features/converter/sampleText.ts` plays for the converter.
 *
 * Unlike the converter's sample (deliberately raw legacy bytes, since it
 * demonstrates *conversion*), this is plain readable text — the comparison
 * engine diffs whatever text it's given, legacy-encoded or not. Mixes
 * Bengali and English and exercises an unchanged line, a small in-paragraph
 * insertion, and a short single-word modification ("Monday" → "Tuesday").
 */
export const SAMPLE_SOURCE = `আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।
চিরদিন তোমার আকাশ, তোমার বাতাস, আমার প্রাণে বাজায় বাঁশি।

The quarterly report was submitted on Monday morning and reviewed by the team.`;

export const SAMPLE_TARGET = `আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।
চিরদিন তোমার আকাশ, তোমার নীল বাতাস, আমার প্রাণে বাজায় বাঁশি।

The quarterly report was submitted on Tuesday morning and reviewed carefully by the whole team.`;
