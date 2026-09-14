import { describe, expect, it } from "vitest";
import { validateTokens, validateUnicodeOutput } from "../engine/validate";
import type { Token } from "../encodings/types";

describe("validateTokens", () => {
  it("is valid when nothing is unmapped", () => {
    const result = validateTokens([{ legacy: "K", unicode: "ক", reorder: "none" }]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("reports unmapped sequences without duplicates", () => {
    const tokens: Token[] = [
      { legacy: "@", unicode: "@", reorder: "none", unmapped: true },
      { legacy: "@", unicode: "@", reorder: "none", unmapped: true },
      { legacy: "#", unicode: "#", reorder: "none", unmapped: true },
    ];
    const result = validateTokens(tokens);
    expect(result.valid).toBe(false);
    expect(result.unmappedSequences.sort()).toEqual(["#", "@"]);
  });
});

describe("validateUnicodeOutput", () => {
  it("accepts well-formed, normalized text", () => {
    const result = validateUnicodeOutput("কক");
    expect(result.valid).toBe(true);
  });

  it("flags text that is not NFC-normalized", () => {
    // The ো vowel sign (U+09CB) canonically decomposes to ে (U+09C7) + া
    // (U+09BE); NFD form therefore differs from NFC for this text.
    const decomposed = "কো".normalize("NFD");
    const result = validateUnicodeOutput(decomposed);
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("Normalization"))).toBe(true);
  });

  it("flags a stray vowel sign with no preceding consonant", () => {
    const result = validateUnicodeOutput("ি");
    expect(result.valid).toBe(false);
  });
});
