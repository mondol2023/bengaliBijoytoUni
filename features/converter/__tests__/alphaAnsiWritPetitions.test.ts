import { describe, expect, it } from "vitest";
import { convertLegacyText } from "../engine/pipeline";

function convert(text: string) {
  const result = convertLegacyText(text, "alpha-ansi");
  if (!result.ok) throw new Error(`conversion failed: ${result.error.message}`);
  return result.value;
}

/**
 * Bytes left unmapped when two High Court judgments (WP 6736/2020 and
 * WP 7824/2016) were uploaded as PDFs. Each legacy string is copied from the
 * AdarshaLipiNormal runs of those files, and each expected word was read off
 * the rendered page, not inferred from the table.
 */
describe("conjunct bytes pinned by the rendered pages", () => {
  const cases: Array<[string, string, string]> = [
    ["ó = ল্ক", "öó¡ue", "শুল্কায়ন"],
    ["ñ = ম্ভ (সম্ভাব্য)", "pñ¡hÉ", "সম্ভাব্য"],
    ["ñ = ম্ভ (সম্ভাবনা)", "pñ¡he¡", "সম্ভাবনা"],
    ["Ù» = স্ত্র, as ¿» = ন্ত্র", "Ù»£", "স্ত্রী"],
    ["ï = ভ্র", "ï¡a¡", "ভ্রাতা"],
    ["Ó = ্ল, another width of Ô", "LÓ¡EX", "ক্লাউড"],
    ["…ç = গুপ্ত (×10, …ç l¡u গুপ্ত রায়)", "…ç", "গুপ্ত"],
    ["…f¹ = গুপ্ত, its one variant spelling", "…f¹", "গুপ্ত"],
    ["ë = ব্ধ", "pwr¥ë", "সংক্ষুব্ধ"],
  ];

  for (const [name, legacy, unicode] of cases) {
    it(`reads ${name}`, () => {
      const out = convert(legacy);
      expect(out.unicodeText).toBe(unicode);
      expect(out.validation.unmappedSequences).toEqual([]);
    });
  }

  it("leaves a bare … as an ellipsis", () => {
    expect(convert("L¡l…").unicodeText).toBe("কার…");
  });

  it("still reads the ¹ pairs as before", () => {
    expect(convert("¢pÜ¡¿¹").unicodeText).toBe("সিদ্ধান্ত");
    expect(convert("Ù¹").unicodeText).toBe("স্ত");
  });
});

describe("ৈ typed as the ে byte then ~", () => {
  it("reads S®~eL¡ as জনৈকা", () => {
    const out = convert("S®~eL¡");
    expect(out.unicodeText).toBe("জনৈকা");
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("reads ®~f¢œL as পৈত্রিক", () => {
    expect(convert("®~f¢œL").unicodeText).toBe("পৈত্রিক");
  });

  it("reads a doubled ~ as one sign (®~~a¢l তৈরি)", () => {
    const out = convert("®~~a¢l");
    expect(out.unicodeText).toBe("তৈরি");
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("still reads the ~ then ে order (রাজনৈতিক)", () => {
    expect(convert("l¡S~®e¢aL").unicodeText).toBe("রাজনৈতিক");
  });
});

describe("অ + া is আ", () => {
  it("reads A¡Ce as আইন, not the invalid অা", () => {
    expect(convert("A¡Ce").unicodeText).toBe("আইন");
  });

  it("reads A¡−hc£e as আবেদীন", () => {
    expect(convert("A¡−hc£e").unicodeText).toBe("আবেদীন");
  });

  it("leaves a bare A as অ", () => {
    expect(convert("AeÉ").unicodeText).toBe("অন্য");
  });
});
