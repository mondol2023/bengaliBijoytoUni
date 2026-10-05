import { describe, expect, it } from "vitest";
import { looksLikeLegacyText } from "../spelling/legacyGate";
import { bijoyFixtures } from "../../converter/__tests__/bijoy.fixtures";

describe("looksLikeLegacyText", () => {
  it("recognises legacy Bijoy text", () => {
    expect(looksLikeLegacyText("wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv")).toBe(true);
  });

  it("recognises a legacy document that mixes in English and numbers", () => {
    const text = "Case No. 12/2020 wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv wkÿv †evW© n‡Z Kw¤úDUvi";
    expect(looksLikeLegacyText(text)).toBe(true);
  });

  it("does not fire on plain English", () => {
    expect(looksLikeLegacyText("The quarterly report was submitted on Monday morning.")).toBe(false);
  });

  it("does not fire on English with a few accented letters", () => {
    const text = "The señor visited the café with Müller, and they read a long report about the naïve plan together.";
    expect(looksLikeLegacyText(text)).toBe(false);
  });

  it("does not fire on typographic quotes and dashes", () => {
    expect(looksLikeLegacyText("“Hello,” she said — it’s fine… really.")).toBe(false);
  });

  it("does not fire on Unicode Bengali, with or without English", () => {
    expect(looksLikeLegacyText("আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।")).toBe(false);
    expect(looksLikeLegacyText("আমার সোনার বাংলা please recieve the payment")).toBe(false);
  });

  it("does not fire on empty text", () => {
    expect(looksLikeLegacyText("")).toBe(false);
    expect(looksLikeLegacyText("  \n ")).toBe(false);
  });

  it("recognises the project's own Bijoy fixtures that contain legacy-range bytes", () => {
    const withHighBytes = bijoyFixtures.filter((f) => /[\u0080-ÿ†‡]/u.test(f.input));
    expect(withHighBytes.length).toBeGreaterThan(0);
    const joined = withHighBytes.map((f) => f.input).join(" ");
    expect(looksLikeLegacyText(joined)).toBe(true);
  });
});
