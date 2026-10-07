import { describe, expect, it } from "vitest";
import { bengaliRatio, isMostlyBengali, normalizeOcrText } from "../postprocess";

describe("normalizeOcrText", () => {
  it("composes Bengali to NFC like the converter's output (ে + া → ো)", () => {
    expect(normalizeOcrText("ো")).toBe("ো");
  });

  it("splits the composition-excluded ড় into ড + nukta, as NFC does", () => {
    expect(normalizeOcrText("ড়")).toBe("ড়");
  });

  it("keeps ZWJ and ZWNJ — they decide how a Bengali conjunct renders", () => {
    expect(normalizeOcrText("র‍্য")).toBe("র‍্য");
    expect(normalizeOcrText("ক‌খ")).toBe("ক‌খ");
  });

  it("normalizes line endings and collapses runs of spaces, tabs and NBSP", () => {
    expect(normalizeOcrText("আমি  \t তুমি  সে\r\nশেষ\rআবার")).toBe("আমি তুমি সে\nশেষ\nআবার");
  });

  it("trims every line and the whole text, and keeps at most one blank line between paragraphs", () => {
    expect(normalizeOcrText("  এক  \n\n\n\n  দুই\t\n \n\n তিন \n\n")).toBe("এক\n\nদুই\n\nতিন");
  });

  it("drops the BOM, soft hyphens and control characters the engine can emit", () => {
    expect(normalizeOcrText("﻿আ­ম\u0000ি\u0007")).toBe("আমি");
  });

  it("returns an empty string for text that is only whitespace or junk", () => {
    expect(normalizeOcrText(" \n\t \u0000 \n")).toBe("");
  });
});

describe("bengaliRatio", () => {
  it("is 1 for Bengali and 0 for Latin", () => {
    expect(bengaliRatio("আমার সোনার বাংলা")).toBe(1);
    expect(bengaliRatio("Hello world")).toBe(0);
  });

  it("counts Bengali digits as Bengali, and ignores spaces, punctuation and the danda", () => {
    expect(bengaliRatio("মামলা নং ২০২৪।")).toBe(1);
    expect(bengaliRatio("... — !!")).toBe(0);
  });

  it("weighs mixed text by character, vowel signs included", () => {
    // আমি = 3 Bengali code points (আ, ম, ি); abc = 3 Latin.
    expect(bengaliRatio("আমি abc")).toBeCloseTo(0.5);
  });

  it("treats ASCII digits as not Bengali, so a Latin number does not pass for a Bengali line", () => {
    expect(bengaliRatio("2024")).toBe(0);
  });

  it("is 0 for empty input rather than NaN", () => {
    expect(bengaliRatio("")).toBe(0);
  });
});

describe("isMostlyBengali", () => {
  it("is true at half and above, false below", () => {
    expect(isMostlyBengali("আমি abc")).toBe(true);
    expect(isMostlyBengali("আ abcdef")).toBe(false);
    expect(isMostlyBengali("")).toBe(false);
  });
});
