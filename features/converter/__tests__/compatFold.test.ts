import { describe, expect, it } from "vitest";
import { normalizeSource } from "../engine/normalizeSource";
import { convertLegacyText } from "../engine/pipeline";
import { getEncoding } from "../encodings/registry";

const bijoy = getEncoding("bijoy")!;
const alphaAnsi = getEncoding("alpha-ansi")!;

/** U+0308 / U+0304 / U+03BC: what NFKC turns "¨", "¯" and "µ" into. */
const DIAERESIS = "̈";
const MACRON = "̄";
const MU = "μ";

function convert(text: string, encodingId = "bijoy") {
  const result = convertLegacyText(text, encodingId);
  if (!result.ok) throw new Error(`conversion failed: ${result.error.message}`);
  return result.value;
}

/**
 * A court order pasted from a PDF or Word arrived with its legacy bytes
 * compatibility-folded: "¨" (ya-fola) as space + U+0308, "¯" (স্) as
 * space + U+0304, "µ" (ক্র) as the Greek mu. None of those is a CP1252 byte,
 * so each was reported as an unmapped character and — because the stray
 * space and mark sat between a consonant and its vowel sign — a "vowel sign
 * with no preceding base consonant" defect on top.
 */
describe("compatibility-folded source bytes are restored", () => {
  it("restores the spacing diaeresis ¨ (ya-fola)", () => {
    const out = convert(`b ${DIAERESIS}vqZt`);
    expect(out.unicodeText).toBe("ন্যায়তঃ");
    expect(out.unicodeText).toBe(convert("b¨vqZt").unicodeText);
    expect(out.validation.warnings).toEqual([]);
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("keeps the real space that follows a restored ¨", () => {
    const out = convert(`Rb ${DIAERESIS} weev\`x`);
    expect(out.unicodeText).toBe("জন্য বিবাদী");
    expect(out.validation.warnings).toEqual([]);
  });

  it("restores the micro sign µ (ক্র) from the Greek mu NFKC turns it into", () => {
    const out = convert(`wW${MU}x`);
    expect(out.unicodeText).toBe("ডিক্রী");
    expect(out.validation.warnings).toEqual([]);
  });

  it("restores the spacing macron ¯ (স্), so the pair with ’ matches again", () => {
    const out = convert(`_vKve ${MACRON}’vq`);
    expect(out.unicodeText).toBe("থাকাবস্থায়");
    expect(out.validation.warnings).toEqual([]);
  });

  it("restores ¯ and µ in one word (স্বয়ংক্রিয়)", () => {
    const folded = convert(` ${MACRON}^qs w${MU}q`);
    const original = convert("¯^qs wµq");
    expect(folded.unicodeText).toBe(original.unicodeText);
    expect(folded.validation.warnings).toEqual([]);
  });

  it("does not leave a pre-base vowel stranded on the fold's stray space", () => {
    // "w¯’iK…Z" folded: the space lands between the pre-base ি and its cluster.
    const out = convert(`w ${MACRON}’iK...Z`);
    expect(out.unicodeText).toBe("স্থিরকৃত");
    // The only note is the reported "..." guess; no unmapped or defect warning.
    expect(out.validation.unmappedSequences).toEqual([]);
    expect(out.validation.sourceSignals.map((signal) => signal.sequence)).toEqual(["..."]);
    expect(out.validation.warnings.join(" ")).not.toMatch(/vowel sign|no mapping rule/);
  });

  it("restores a bare combining mark that arrived without its space", () => {
    expect(normalizeSource(`b${DIAERESIS}vqZt`, bijoy).text).toBe("b¨vqZt");
  });

  it("leaves a genuine decomposed Latin letter (e + U+0308) alone", () => {
    const text = `Zvi caf${"e"}${DIAERESIS}`;
    expect(normalizeSource(text, bijoy).text).toBe(text);
  });

  it("consumes exactly the one space the fold added", () => {
    // "a ¨" folds to "a" + " " + " ̈": the first space was really there.
    expect(normalizeSource(`a  ${DIAERESIS}`, bijoy).text).toBe("a ¨");
  });

  it("only restores bytes the active encoding actually maps", () => {
    // alpha-ANSI has no "¯" rule, so there is nothing to restore it to; it does
    // map "¨" (ূ) and "µ" (চ্), so those fold back to their bytes.
    const noRule = `b ${MACRON}vqZt`;
    expect(normalizeSource(noRule, alphaAnsi).text).toBe(noRule);
    expect(normalizeSource(`b ${DIAERESIS}vqZt`, alphaAnsi).text).toBe("b¨vqZt");
    expect(normalizeSource(`k¡−${MU}R`, alphaAnsi).text).toBe("k¡−µR");
  });

  it("reports the restored text as the source, so every offset indexes into it", () => {
    const out = convert(`b ${DIAERESIS}vqZt 中`);
    expect(out.sourceText).toBe("b¨vqZt 中");
    const [detail] = out.validation.unmappedDetails;
    expect(detail.sequence).toBe("中");
    expect(out.sourceText[detail.positions[0]]).toBe("中");
  });

  it("is not triggered by clean legacy text", () => {
    const text = "Rb¨ weev`x µ ¯’vb w³";
    expect(normalizeSource(text, bijoy).text).toBe(text);
    expect(normalizeSource(text, bijoy).signals).toEqual([]);
  });
});

describe("a superpowered digit folded to a plain digit (³ → 3)", () => {
  it("restores ³ (ক্ত) when it follows a pre-base vowel, where a digit cannot be", () => {
    // "Pzw³cÎ" → "Pzw3cÎ": the digit sat between ি and প, i.e. "চু৩িপত্র".
    const out = convert("Pzw3cÎ");
    expect(out.unicodeText).toBe("চুক্তিপত্র");
    expect(out.unicodeText).toBe(convert("Pzw³cÎ").unicodeText);
  });

  it("restores it on its own, with no other sign of folding in the text", () => {
    expect(normalizeSource("e¨w3MZ", bijoy).text).toBe("e¨w³MZ");
  });

  it("leaves ordinary numerals alone", () => {
    for (const text of ["1g 3q", "ZvwiL 23/10/2020", "bs 3", "(3)", "‡Kvb 3 wU"]) {
      expect(normalizeSource(text, bijoy).text).toBe(text);
    }
  });
});

/**
 * The next two repairs are guesses — "D3" could be a numeral glued to a word,
 * "K...Z" could be a real ellipsis — so they only run in text that has already
 * proved it went through compatibility folding, and they are reported.
 */
describe("evidence-gated repairs", () => {
  const PROOF = `b ${DIAERESIS}vqZt`;

  it("restores a ³ glued to a letter (উক্ত) once the text shows it was folded", () => {
    const out = convert(`D3 ${PROOF}`);
    expect(out.unicodeText).toBe(convert("D³ b¨vqZt").unicodeText);
    expect(out.unicodeText.startsWith("উক্ত")).toBe(true);
  });

  it("leaves the same glued digit alone when nothing proves the text was folded", () => {
    const text = "D3 b¨vqZt";
    expect(normalizeSource(text, bijoy).text).toBe(text);
    expect(convert(text).unicodeText.startsWith("উ৩")).toBe(true);
  });

  it("keeps real numerals even in folded text", () => {
    const out = convert(`${PROOF} 3 (3) 13 D 3`);
    expect(out.unicodeText).toContain("৩");
    expect(out.unicodeText).toContain("(৩)");
    expect(out.unicodeText).toContain("১৩");
  });

  it("restores a three-dot ellipsis glued between letters (K…Z, কৃত)", () => {
    const out = convert(`${PROOF} cybivq K...Z`);
    expect(out.unicodeText).toBe(convert("b¨vqZt cybivq K…Z").unicodeText);
    expect(out.unicodeText).toContain("কৃত");
  });

  it("leaves a real ellipsis alone: spaced, longer, or in unfolded text", () => {
    expect(normalizeSource("K...Z", bijoy).text).toBe("K...Z");
    expect(normalizeSource(`${PROOF} K ... Z`, bijoy).text).toBe("b¨vqZt K ... Z");
    expect(normalizeSource(`${PROOF} K....Z`, bijoy).text).toBe("b¨vqZt K....Z");
    expect(normalizeSource(`${PROOF} K...`, bijoy).text).toBe("b¨vqZt K...");
  });

  it("reports each guess as a signal so a reviewer can see it happened", () => {
    const { signals } = normalizeSource(`${PROOF} D3 K...Z K...Z`, bijoy);
    const bySequence = Object.fromEntries(signals.map((signal) => [signal.sequence, signal]));
    expect(bySequence["3"].count).toBe(1);
    expect(bySequence["3"].unicode).toBe("ক্ত");
    expect(bySequence["..."].count).toBe(2);
    expect(bySequence["..."].unicode).toBe("ৃ");
    expect(bySequence["..."].message).toContain("compatibility");
  });

  it("does not report the certain repairs, which are not guesses", () => {
    expect(normalizeSource(`${PROOF} Pzw3cÎ wW${MU}x`, bijoy).signals).toEqual([]);
  });
});

describe("compatibility folding — scale", () => {
  it("stays linear on a long folded document", () => {
    const unit = `Rb ${DIAERESIS} weev\`x wW${MU}x _vKve ${MACRON}’vq Pzw3cÎ K...Z\n`;
    const text = unit.repeat(20_000);
    const started = performance.now();
    const out = convert(text);
    const elapsed = performance.now() - started;
    expect(out.validation.unmappedSequences).toEqual([]);
    expect(elapsed).toBeLessThan(4000);
  });
});
