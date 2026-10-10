import { describe, expect, it } from "vitest";
import { convertLegacyText } from "../engine/pipeline";

function convert(text: string) {
  const result = convertLegacyText(text, "alpha-ansi");
  if (!result.ok) throw new Error(`conversion failed: ${result.error.message}`);
  return result.value;
}

/**
 * Bytes a user's land-suit document raised as unmapped (167 of them). Each
 * legacy string below is spelled with this table's own bytes; the expected
 * word is the one the document's converted text sat in ("কি¿º ঠান্ডা",
 * "প্রÙºতি", "ভ¨মি", "জ~েনক" ...), so every case is backed by real words.
 */
describe("º is the ু half of a conjunct pair, as ¹ is the bare half", () => {
  it("reads ¿º as ন্তু (কিন্তু)", () => {
    const out = convert("¢L¿º");
    expect(out.unicodeText).toBe("কিন্তু");
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("reads Ùº as স্তু (প্রস্তুতি)", () => {
    const out = convert("fËÙº¢a");
    expect(out.unicodeText).toBe("প্রস্তুতি");
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("still reads ¿¹ as ন্ত and Ù¹ as স্ত", () => {
    expect(convert("¢pÜ¡¿¹").unicodeText).toBe("সিদ্ধান্ত");
    expect(convert("Ù¹").unicodeText).toBe("স্ত");
  });
});

describe("single bytes for conjuncts and a ূ-kar", () => {
  it("reads ¨ as ূ, the middle of the § ¨ © run (ভূমি)", () => {
    const out = convert("i¨¢j");
    expect(out.unicodeText).toBe("ভূমি");
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("reads õ as ল্ল (উল্লেখিত, মোতাওয়াল্লি)", () => {
    expect(convert("E−õ¢Ma").unicodeText).toBe("উল্লেখিত");
    expect(convert("−j¡a¡Ju¡¢õ").unicodeText).toBe("মোতাওয়াল্লি");
  });

  it("reads ý as হু (রুহুল, হুমকি)", () => {
    expect(convert("l¦ým").unicodeText).toBe("রুহুল");
    expect(convert("ýj¢L").unicodeText).toBe("হুমকি");
  });
});

describe("~ + ে is ৈ", () => {
  it("reads ~® before a consonant as ৈ (জনৈক, জনৈকা, পৈত্রিক, রাজনৈতিক)", () => {
    for (const [legacy, word] of [
      ["S~®eL", "জনৈক"],
      ["S~®eL¡", "জনৈকা"],
      ["~®f¢œL", "পৈত্রিক"],
      ["l¡S~®e¢aL", "রাজনৈতিক"],
    ]) {
      const out = convert(legacy);
      expect(out.unicodeText).toBe(word);
      expect(out.validation.unmappedSequences).toEqual([]);
    }
  });

  it("accepts every copy-path spelling of the ে byte", () => {
    expect(convert("S~−eL").unicodeText).toBe("জনৈক");
    expect(convert("S~­eL").unicodeText).toBe("জনৈক");
  });

  it("leaves a ~ that is not followed by ে flagged as unmapped", () => {
    const out = convert("S~eL");
    expect(out.validation.unmappedSequences).toEqual(["~"]);
  });
});

describe("bytes from the raw plaint: å ´ Õ", () => {
  it("reads å as ন্ধ (অনুসন্ধান, 6 of its 8 uses)", () => {
    const out = convert("Ae¤på¡−el");
    expect(out.unicodeText).toBe("অনুসন্ধানের");
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("reads ´ as the half form ঙ্ (পুঙ্খ in পুঙ্খানুপুঙ্খ)", () => {
    const out = convert("f¤´M¡e¤");
    expect(out.unicodeText).toBe("পুঙ্খানু");
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("reads Õ as the half form শ্ and lets the i-kar span the cluster (নিশ্চিত)", () => {
    const out = convert("¢e¢ÕQaLlZ");
    expect(out.unicodeText).toBe("নিশ্চিতকরণ");
    expect(out.validation.unmappedSequences).toEqual([]);
  });
});
