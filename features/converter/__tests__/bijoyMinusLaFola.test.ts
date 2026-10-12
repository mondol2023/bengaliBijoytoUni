import { describe, expect, it } from "vitest";
import { detectEncoding } from "../engine/detectEncoding";
import { convertLegacyText } from "../engine/pipeline";
import { alphaAnsiFixtures } from "./alphaAnsi.fixtures";

/**
 * A PDF copy path delivers cp1252 0xAD (Bijoy's la-fola) as U+2212 rather than
 * U+00AD. A 2023 High Court appeal pasted from such a PDF has it in
 * কুমিল্লা / উল্লেখ / ডব্লিউ, read off against an independent transcription.
 * `map.ts` still refuses U+2212 as a table rule (it is alpha-ANSI's e-kar and
 * would inflate Bijoy's detection score), so the fix lives in `postProcess`,
 * which `detectEncoding` never runs.
 */
function convert(text: string, encodingId = "bijoy") {
  const result = convertLegacyText(text, encodingId);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("Bijoy: U+2212 as the la-fola byte", () => {
  it.each([
    ["Kzwgj−v", "কুমিল্লা"],
    ["D‡j−L", "উল্লেখ"],
    ["wc Wwe−D", "পি ডব্লিউ"],
  ])("reads %s as %s", (input, expected) => {
    const out = convert(input);
    expect(out.unicodeText).toBe(expected);
    expect(out.validation.unmappedSequences).toEqual([]);
  });

  it("gives the same result as the soft-hyphen spelling", () => {
    expect(convert("Kzwgj\u2212v").unicodeText).toBe(convert("Kzwgj\u00ADv").unicodeText);
  });

  it("applies to SutonnyMJ, which shares the table", () => {
    expect(convert("Kzwgj−v", "sutonny").unicodeText).toBe("কুমিল্লা");
  });

  it("does not touch alpha-ANSI, where U+2212 is the e-kar", () => {
    expect(convert("−L", "alpha-ansi").unicodeText).toBe("কে");
  });

  it("does not raise Bijoy's detection score on alpha-ANSI text", () => {
    const detection = detectEncoding(alphaAnsiFixtures.at(-1)!.input);
    expect(detection.encodingId).toBe("alpha-ansi");
  });
});

describe("taka notation", () => {
  it("passes /= through without reporting it unmapped", () => {
    const out = convert("27,76,323/= UvKv");
    expect(out.unicodeText).toBe("২৭,৭৬,৩২৩/= টাকা");
    expect(out.validation.unmappedSequences).toEqual([]);
  });
});
