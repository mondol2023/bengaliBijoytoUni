/**
 * Font-aware conversion of mixed English/legacy-Bengali documents.
 *
 * The strings are taken from real Bangladeshi Supreme Court judgment PDFs,
 * where a flat single-encoding conversion turned the English half of the
 * document into Bengali-looking nonsense ("Call for the records" →
 * "ইতরর পষক্ষ tবন ক্ষনদষক্ষধড়"). The false-positive cases are the ones a run
 * over a 402-PDF corpus actually produced before `hasLegacyEvidence` existed.
 */
import { describe, expect, it } from "vitest";
import { baseFontName, verdictForFontName } from "../encodings/fontFamilies";
import { classifyFonts, convertRuns, hasLegacyEvidence, type SourceRun } from "../engine/fontRuns";
import { joinSegments } from "../engine/pipeline";

const adarsha = (text: string): SourceRun => ({ text, fontKey: "f1", fontName: "ABCDEE+AdarshaLipiNormal" });
const times = (text: string): SourceRun => ({ text, fontKey: "f2", fontName: "Times New Roman,Italic" });
const layout = (text: string): SourceRun => ({ text, fontKey: "layout" });

function convert(runs: SourceRun[], encodingOverride?: string) {
  const result = convertRuns(runs, { encodingOverride });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("font names", () => {
  it("strips the subset tag and style suffix", () => {
    expect(baseFontName("ABCDEE+AdarshaLipiNormal")).toBe("AdarshaLipiNormal");
    expect(baseFontName("SutonnyMJ,Bold")).toBe("SutonnyMJ");
    expect(baseFontName("Times New Roman,Italic")).toBe("Times New Roman");
  });

  it("names the encoding of the legacy fonts seen in the corpus", () => {
    expect(verdictForFontName("ABCDEE+AdarshaLipiNormal")).toEqual({ kind: "legacy", encodingId: "alpha-ansi" });
    expect(verdictForFontName("SutonnyMJ,Italic")).toEqual({ kind: "legacy", encodingId: "sutonny" });
  });

  it("keeps Latin and Unicode Bengali fonts, and has no opinion on anonymized ones", () => {
    expect(verdictForFontName("Times New Roman")).toEqual({ kind: "keep" });
    expect(verdictForFontName("TimesNewRomanPS-BoldMT")).toEqual({ kind: "keep" });
    expect(verdictForFontName("Vrinda,Bold")).toEqual({ kind: "keep" });
    expect(verdictForFontName("CIDFont+F3")).toBeUndefined();
    expect(verdictForFontName(null)).toBeUndefined();
  });
});

describe("convertRuns", () => {
  it("converts the legacy font and leaves the English font untouched", () => {
    const output = convert([
      adarsha("h¡wm¡"),
      adarsha(" "),
      adarsha("p¤fË£j ®L¡VÑ"),
      layout("\n"),
      times("“Call for the records and issue a Rule calling"),
    ]);
    expect(output.unicodeText).toBe("বাংলা সুপ্রীম কোর্ট\n“Call for the records and issue a Rule calling");
    expect(output.encodingId).toBe("alpha-ansi");
    expect(output.keptChars).toBeGreaterThan(0);
    expect(joinSegments(output.outputSegments)).toBe(output.unicodeText);
  });

  it("does not split a cluster whose pre-base kar ends one run", () => {
    expect(convert([adarsha("¢"), adarsha("L")]).unicodeText).toBe("কি");
  });

  it("shifts unmapped positions into the combined source text", () => {
    const output = convert([times("Title Suit No. 83 of 1994 "), adarsha("L¡Ã")]);
    const [detail] = output.validation.unmappedDetails;
    expect(detail.sequence).toBe("Ã");
    expect(output.sourceText.slice(detail.positions[0], detail.positions[0] + 1)).toBe("Ã");
  });

  it("applies the user's encoding to legacy text only", () => {
    const output = convert([adarsha("evsjv"), times("Call for the records")], "bijoy");
    expect(output.unicodeText).toBe("বাংলাCall for the records");
    expect(output.fontDecisions.find((d) => d.fontKey === "f1")?.decision).toMatchObject({ reason: "user-choice" });
  });

  it("fails like the single-encoding path when nothing in the document is legacy", () => {
    const result = convertRuns([times("Equitable principles have been merged with law")]);
    expect(result.ok).toBe(false);
  });
});

describe("anonymized fonts are classified by content", () => {
  const cid = (fontKey: string, text: string): SourceRun => ({ text, fontKey, fontName: `CIDFont+${fontKey}` });

  it("detects alpha-ANSI and Bijoy text in fonts with no usable name", () => {
    const decisions = classifyFonts([
      cid("F3", "¢hQ¡l fÜ¢az-(1)HC BCel Ad£e ®L¡e Afl¡dl ¢hQ¡l ®Lhmj¡œ d¡l¡ 25 Hl Ad£e"),
      cid("F5", "3) mKj wPwKrm‡Ki AeMwZi Rb¨ Rvbv‡bv hvB‡Z‡Q †h, 2009Bs m‡bi 01jv Rvbyqvwi"),
    ]);
    expect(decisions.get("F3")).toMatchObject({ kind: "legacy", encodingId: "alpha-ansi" });
    expect(decisions.get("F5")).toMatchObject({ kind: "legacy", encodingId: "bijoy" });
  });

  it.each([
    ["a judge's name", "Md. Khairul Alam, J. , J"],
    ["Latin legal phrases", "inter alia locus standi exparte status quo Jahangir/Bench Officer."],
    ["English prose", "Let a Rule Nisi be issued calling upon the respondents to show cause"],
    ["source code", 'useEffect(() => { fetch("/api/products") onAddToCart={handleAddToCart} key={product.id}'],
    ["symbols", "✓ ✓ ⇄ → → ❌ ▼"],
    ["a broken Vrinda text layer", "\u0001 \u0002\u0003 \u0004 \u0005"],
  ])("keeps %s, even when a legacy font elsewhere sets the document's encoding", (_label, text) => {
    const decisions = classifyFonts([adarsha("h¡wm¡ p¤fË£j ®L¡VÑ"), cid("F4", text)]);
    expect(decisions.get("F4")?.kind).toBe("keep");
  });

  it("requires legacy evidence, not just a fluent detection score", () => {
    expect(hasLegacyEvidence("Naima Haider, J; Khizir Ahmed Choudhury, J: I agree.")).toBe(false);
    expect(hasLegacyEvidence("pne- 43/2017 ew j¡jm¡u k¤NÈ c¡ul¡")).toBe(true);
  });
});
