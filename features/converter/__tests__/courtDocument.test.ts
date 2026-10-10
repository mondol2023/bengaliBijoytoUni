import { describe, expect, it } from "vitest";
import { convertLegacyText } from "../engine/pipeline";

const DIAERESIS = "̈";
const FRACTION_SLASH = "⁄";

function convert(text: string, encodingId = "bijoy") {
  const result = convertLegacyText(text, encodingId);
  if (!result.ok) throw new Error(`conversion failed: ${result.error.message}`);
  return result.value;
}

/**
 * Regressions from a real Bangladeshi court document (a plaint and a lease
 * clause) that was pasted after Word had compatibility-folded it.
 */
describe("a '3' after an opening-quote byte is a digit, not ক্ত", () => {
  const folded = `b ${DIAERESIS}vqZt Zckx‡jv3 Ò3 (wZb)`;

  it("keeps the numeral after Ò", () => {
    const out = convert(folded);
    expect(out.unicodeText).toBe("ন্যায়তঃ তপশীলোক্ত “৩ (তিন)");
  });

  it("keeps a 3 that ends a number (2023, 13) in folded text", () => {
    const out = convert(`${folded} 04/10/2023 13`);
    expect(out.unicodeText).toContain("০৪/১০/২০২৩ ১৩");
  });

  it("still restores the glued 3 after a letter in the same text", () => {
    const out = convert(folded);
    const guess = out.validation.sourceSignals?.find((s) => s.sequence === "3");
    expect(guess?.count).toBe(1);
  });
});

describe("র + ু and ন্ + ত are not read as the ম্ন / ত্ম conjunct bytes", () => {
  it("reads iæ as রু (weiæ‡× = বিরুদ্ধে)", () => {
    expect(convert("weiæ‡×").unicodeText).toBe("বিরুদ্ধে");
  });

  it("reads šÍ as ন্ত (ch©šÍ = পর্যন্ত)", () => {
    expect(convert("ch©šÍ").unicodeText).toBe("পর্যন্ত");
  });

  it("still reads a bare æ as ম্ন (wbæ = নিম্ন)", () => {
    expect(convert("wbæ").unicodeText).toBe("নিম্ন");
  });

  it("still reads a bare Í as ত্ম (AvÍv = আত্মা)", () => {
    expect(convert("AvÍv").unicodeText).toBe("আত্মা");
  });
});

describe("compatibility-folded vulgar fractions are restored", () => {
  it("restores ½ (ঙ্গ) from 1⁄2: যুক্তিসঙ্গত", () => {
    const folded = convert(`hyw3m1${FRACTION_SLASH}2Z`);
    expect(folded.unicodeText).toBe("যুক্তিসঙ্গত");
    expect(folded.validation.unmappedSequences).toEqual([]);
    expect(folded.unicodeText).toBe(convert("hyw³m½Z").unicodeText);
  });

  it("restores ¼ (ঙ্ক) from 1⁄4 and ¾ (জ্জ) from 3⁄4", () => {
    expect(convert(`1${FRACTION_SLASH}4`).unicodeText).toBe(convert("¼").unicodeText);
    expect(convert(`3${FRACTION_SLASH}4`).unicodeText).toBe(convert("¾").unicodeText);
  });

  it("leaves a fraction alone in text that already holds Unicode Bengali", () => {
    const out = convert(`আজ 1${FRACTION_SLASH}2 ভাগ`);
    expect(out.unicodeText).not.toContain("ঙ্গ");
  });
});

describe("শ + ব-ফলা written with ¡", () => {
  it("reads k¡ as শ্ব (wek¡bv_ = বিশ্বনাথ)", () => {
    const out = convert("wek¡bv_");
    expect(out.unicodeText).toBe("বিশ্বনাথ");
    expect(out.validation.unmappedSequences).toEqual([]);
  });
});
