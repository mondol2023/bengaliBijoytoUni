import { describe, expect, it } from "vitest";
import {
  formatUnmappedDetails,
  validateTokens,
  validateUnicodeOutput,
} from "../engine/validate";
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

  // A bare list of bytes ("¿, ø, ü, â, …") tells a user nothing they can
  // act on. Each unmapped sequence has to come back with the converted text
  // around it, so the missing conjunct can be recognised and turned into a
  // fixture — that is the whole point of `unmappedDetails`.
  it("reports each unmapped sequence with its count and surrounding text", () => {
    const tokens: Token[] = [
      { legacy: "S", unicode: "জ", reorder: "none" },
      { legacy: "¢", unicode: "ি", reorder: "none" },
      { legacy: "j", unicode: "ম", reorder: "none" },
      { legacy: "Ê", unicode: "Ê", reorder: "none", unmapped: true },
      { legacy: "j", unicode: "ম", reorder: "none" },
      { legacy: "¡", unicode: "া", reorder: "none" },
      { legacy: "Ê", unicode: "Ê", reorder: "none", unmapped: true },
    ];
    const result = validateTokens(tokens);

    expect(result.unmappedDetails).toHaveLength(1);
    const [detail] = result.unmappedDetails;
    expect(detail.sequence).toBe("Ê");
    expect(detail.count).toBe(2);
    expect(detail.contexts).toHaveLength(2);
    // The window is built from the reordered tokens, so it reads as the
    // Bangla the user is looking at, with the offending byte bracketed.
    expect(detail.contexts[0]).toContain("⟦Ê⟧");
    expect(detail.contexts[0]).toContain("মা");
  });

  it("orders details by frequency, so the most damaging byte is first", () => {
    const tokens: Token[] = [
      { legacy: "#", unicode: "#", reorder: "none", unmapped: true },
      { legacy: "@", unicode: "@", reorder: "none", unmapped: true },
      { legacy: "@", unicode: "@", reorder: "none", unmapped: true },
    ];
    const result = validateTokens(tokens);
    expect(result.unmappedDetails.map((detail) => detail.sequence)).toEqual(["@", "#"]);
  });

  it("flattens details to prose for log rows, capped at the requested count", () => {
    const tokens: Token[] = [
      { legacy: "@", unicode: "@", reorder: "none", unmapped: true },
      { legacy: "#", unicode: "#", reorder: "none", unmapped: true },
      { legacy: "$", unicode: "$", reorder: "none", unmapped: true },
    ];
    const prose = formatUnmappedDetails(validateTokens(tokens).unmappedDetails, 2);
    const lines = prose.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"@"');
    expect(lines[2]).toContain("1 more unmapped sequence");
  });

  it("has nothing to format when the conversion was clean", () => {
    expect(formatUnmappedDetails([])).toBe("");
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
