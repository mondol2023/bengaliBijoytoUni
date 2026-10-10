import { describe, expect, it } from "vitest";
import { convertLegacyText } from "../engine/pipeline";
import { classifyValidationWarning } from "../engine/classify";
import {
  findForeignEncoding,
  looksLikeGlyphOrderText,
  NO_TEXT_MAP_MESSAGE,
} from "../engine/diagnose";
import type { UnmappedDetail } from "../engine/validate";

const detail = (sequence: string, count: number): UnmappedDetail => ({
  sequence,
  count,
  contexts: [],
  positions: [],
});

/**
 * Log 4 of docs/engine-review-2026-10-10.md: a PDF whose subset font has no
 * ToUnicode map hands back glyph codes in order of first use, so the "text" is
 * a run of consecutive ASCII punctuation. Lines are copied from that log's
 * context windows.
 */
const GLYPH_ORDER_PAGE = [
  `! " # $ % & ' ( ) * + , - . / = > @`,
  `( ' ) * + # , - . - - $ + = ! > < @ | ~`,
  `" # $ % ' ( ) * + , - . ! > = < @ ~ |`,
].join("\n");

describe("looksLikeGlyphOrderText", () => {
  it("flags a page of consecutive ASCII punctuation (a font with no text map)", () => {
    expect(looksLikeGlyphOrderText(GLYPH_ORDER_PAGE)).toBe(true);
  });

  it.each([
    ["Bijoy prose", "Avwg evsjvq Mvb MvB| Avgvi evsjvi gvwU Avgvi Mv‡q gvLv|"],
    ["English prose", "The quick brown fox jumps over the lazy dog, (twice) - and then rests."],
    ["a reference table", "123/2020 Dag 45/B A/C 0012-3456 Rs.5000/- 1,234.50 2,000.00"],
    ["dotted leaders", "Name ............................ Date ............................"],
    ["a ruled line", "-------------------------------------------"],
    ["a few symbols", "(a) (b) (c)"],
    ["empty text", ""],
  ])("does not flag %s", (_name, text) => {
    expect(looksLikeGlyphOrderText(text)).toBe(false);
  });
});

describe("findForeignEncoding", () => {
  // The unmapped set from the 430-character alpha-ANSI log: most are Bijoy bytes.
  const BIJOY_BYTES = [
    detail("t", 268),
    detail("$", 26),
    detail("‡", 18),
    detail("`", 8),
    detail("_", 6),
    detail("†", 5),
  ];

  it("names the encoding that maps most of the unmapped bytes", () => {
    const hint = findForeignEncoding(BIJOY_BYTES, "alpha-ansi");
    expect(hint?.encodingId).toBe("bijoy");
    expect(hint?.mappedCount).toBe(331);
    expect(hint?.totalCount).toBe(331);
  });

  it("stays quiet when the text is already in that encoding", () => {
    expect(findForeignEncoding(BIJOY_BYTES, "bijoy")?.encodingId).not.toBe("bijoy");
  });

  it("stays quiet for a lone byte, which is evidence of a missing rule, not a wrong encoding", () => {
    expect(findForeignEncoding([detail("t", 8)], "alpha-ansi")).toBeUndefined();
  });

  it("stays quiet when no other encoding maps the bytes", () => {
    const unknown = [detail("#", 5), detail("*", 5), detail("@", 5), detail("<", 5)];
    expect(findForeignEncoding(unknown, "alpha-ansi")).toBeUndefined();
  });
});

describe("pipeline diagnostics", () => {
  it("explains a glyph-order page instead of only listing symbols", () => {
    const result = convertLegacyText(GLYPH_ORDER_PAGE, "alpha-ansi");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.validation.valid).toBe(false);
    expect(result.value.validation.warnings).toContain(NO_TEXT_MAP_MESSAGE);
    expect(classifyValidationWarning(NO_TEXT_MAP_MESSAGE)).toBe("invalid_encoding");
  });

  it("points at Bijoy when alpha-ANSI was chosen for Bijoy-only bytes", () => {
    const result = convertLegacyText("L‡`|~^_†$ L", "alpha-ansi");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hint = result.value.validation.warnings.find((w) => w.includes("belong to"));
    expect(hint).toBeDefined();
    expect(hint).toContain("Bijoy");
    expect(classifyValidationWarning(hint!)).toBe("invalid_encoding");
  });

  it("carries the suggested encoding id so the UI can offer a one-click switch", () => {
    const result = convertLegacyText("L‡`|~^_†$ L", "alpha-ansi");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.validation.suggestedEncodingId).toBe("bijoy");
  });

  it("suggests nothing when the unmapped bytes belong to no other encoding", () => {
    const result = convertLegacyText("L# L* L@ L<", "alpha-ansi");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.validation.suggestedEncodingId).toBeUndefined();
  });

  it("adds no diagnostic to a clean conversion", () => {
    const result = convertLegacyText("Avwg evsjvq", "bijoy");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.validation.warnings).toEqual([]);
  });
});
