/**
 * What a font's *name* says about the bytes set in it.
 *
 * A legacy Bengali document is CP1252 bytes rendered through a font whose
 * glyphs happen to be Bengali. The same bytes in Times New Roman are English.
 * So inside a document that carries font information (a PDF or DOCX), the font name
 * is the strongest evidence there is about which runs to convert — far
 * stronger than anything the bytes alone can say, because Bijoy text is
 * mostly plain ASCII letters.
 *
 * Only names with evidence behind them are listed. Every legacy entry was
 * seen in the Bangladeshi Supreme Court judgment corpus and its text
 * converted correctly with the table named here:
 *
 * - `AdarshaLipiNormal` → alpha-ANSI ("h¡wm¡ p¤fË£j ®L¡VÑ" → "বাংলা সুপ্রীম কোর্ট").
 * - `SutonnyMJ` (and `,Bold`/`,Italic`) → SutonnyMJ ("Rbve wePvicwZ" → "জনাব বিচারপতি").
 *
 * Anything not listed returns `undefined` and is classified by its content
 * instead (`engine/fontRuns.ts`). PDF producers often anonymize embedded
 * fonts as `CIDFont+F3`, and those carry legacy Bengali as often as English.
 */

export type FontNameVerdict =
  /** The font is a legacy Bengali font laid out in this encoding. */
  | { kind: "legacy"; encodingId: string }
  /** The font renders its bytes as themselves (Latin, symbols): never convert. */
  | { kind: "keep" };

/** Strips a PDF subset tag (`ABCDEE+`) and a style suffix (`,Bold`, `-Italic`). */
export function baseFontName(fontName: string): string {
  return fontName
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/[,-](Bold|Italic|Oblique|BoldItalic|BoldOblique|Regular|Roman|PSMT|PS-BoldMT|MT)+$/i, "")
    .trim();
}

const LEGACY_FONTS: ReadonlyArray<{ pattern: RegExp; encodingId: string }> = [
  { pattern: /^AdarshaLipi/i, encodingId: "alpha-ansi" },
  { pattern: /^Sutonny.*MJ$/i, encodingId: "sutonny" },
];

/**
 * Latin/symbol families whose glyphs are what their bytes say. Matching one
 * of these means a reader saw English (or a symbol), so converting it can
 * only produce garbage — the defect a mixed English/Bengali judgment exposed,
 * where "Call for the records" came out as "ইতরর পষক্ষ tবন ক্ষনদষক্ষধড়".
 */
const LATIN_FONTS =
  /^(Times|TimesNewRoman|Arial|Calibri|Cambria|Helvetica|Courier|CourierNew|Bookman|BookmanOldStyle|BookAntiqua|Garamond|Georgia|Verdana|Tahoma|Segoe|Century|Palatino|Candara|Consolas|Constantia|Corbel|MaiandraGD|Symbol|Wingdings|ZapfDingbats)/i;

/**
 * Unicode Bengali fonts, plus `GlyphLessFont` (the invisible text layer OCR
 * tools such as Tesseract write, always Unicode). Text in these is either
 * already Unicode or — Vrinda in several court PDFs — a broken text layer of
 * control characters; neither is legacy bytes, and converting the latter
 * produced confident-looking nonsense.
 */
const UNICODE_FONTS =
  /^(Vrinda|Nikosh|NirmalaUI|Kalpurush|SolaimanLipi|Siyamrupali|NotoSansBengali|NotoSerifBengali|ShonarBangla|GlyphLessFont)/i;

export function verdictForFontName(fontName: string | null | undefined): FontNameVerdict | undefined {
  if (!fontName) return undefined;
  const base = baseFontName(fontName).replace(/\s+/g, "");
  for (const { pattern, encodingId } of LEGACY_FONTS) {
    if (pattern.test(base)) return { kind: "legacy", encodingId };
  }
  if (LATIN_FONTS.test(base) || UNICODE_FONTS.test(base)) return { kind: "keep" };
  return undefined;
}
