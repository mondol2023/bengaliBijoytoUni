/**
 * The segment cut, tested against the one property everything downstream
 * relies on: the segments rejoin to `unicodeText` exactly. A cut that is
 * merely plausible would splice a fallback into the wrong place.
 */
import { describe, expect, it } from "vitest";
import { convertLegacyText, joinSegments } from "../engine/pipeline";
import { listEncodings } from "../encodings/registry";
import { SAMPLE_TEXT } from "../sampleText";
import { bijoyFixtures } from "./bijoy.fixtures";
import { sutonnyFixtures } from "./sutonny.fixtures";
import { alphaAnsiFixtures } from "./alphaAnsi.fixtures";

function convert(text: string, encodingId: string) {
  const result = convertLegacyText(text, encodingId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

describe("segments rejoin to the engine's own output", () => {
  const cases: Array<[string, string, string]> = [
    ...bijoyFixtures.map((f): [string, string, string] => [`bijoy: ${f.description}`, f.input, "bijoy"]),
    ...sutonnyFixtures.map((f): [string, string, string] => [`sutonny: ${f.description}`, f.input, "sutonny"]),
    ...alphaAnsiFixtures.map((f): [string, string, string] => [
      `alpha-ansi: ${f.description}`,
      f.input,
      "alpha-ansi",
    ]),
  ];

  for (const [name, input, encodingId] of cases) {
    it(name, () => {
      const output = convert(input, encodingId);
      expect(joinSegments(output.outputSegments)).toBe(output.unicodeText);
    });
  }

  it("holds for every registered encoding's sample text", () => {
    for (const encoding of listEncodings()) {
      const output = convert(SAMPLE_TEXT[encoding.id], encoding.id);
      expect(joinSegments(output.outputSegments), encoding.id).toBe(output.unicodeText);
    }
  });
});

describe("what a segment is", () => {
  // "Av" is a Bijoy rule; "\u00a4" matches no rule in any of these tables.
  const withUnmapped = "Av\u00a4Kv";

  it("gives an unmapped byte a segment of its own, carrying the raw byte", () => {
    const output = convert(withUnmapped, "bijoy");
    const unmapped = output.outputSegments.filter((segment) => segment.unmapped);
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0].text).toBe("\u00a4");
    expect(joinSegments(output.outputSegments)).toBe(output.unicodeText);
  });

  it("keys that segment by the same string the store keys a resolution by", () => {
    const output = convert(withUnmapped, "bijoy");
    const sequences = output.validation.unmappedDetails.map((detail) => detail.sequence);
    for (const segment of output.outputSegments.filter((s) => s.unmapped)) {
      expect(sequences).toContain(segment.text);
    }
  });

  it("locates that segment in the source text", () => {
    const output = convert(withUnmapped, "bijoy");
    const unmapped = output.outputSegments.find((segment) => segment.unmapped);
    expect(unmapped).toBeDefined();
    expect(output.sourceText[unmapped!.sourceIndex]).toBe("\u00a4");
  });

  it("merges consecutive mapped tokens into one run", () => {
    const output = convert(withUnmapped, "bijoy");
    expect(output.outputSegments.map((segment) => segment.unmapped)).toStrictEqual([
      false,
      true,
      false,
    ]);
  });

  it("emits no unmapped segment for a clean conversion", () => {
    const output = convert("Av", "bijoy");
    expect(output.outputSegments.every((segment) => !segment.unmapped)).toBe(true);
  });

  it("treats already-Unicode input as one mapped run, matching its validation", () => {
    const output = convert("আমার সোনার বাংলা আমি তোমায় ভালোবাসি", "bijoy");
    expect(output.validation.alreadyUnicode).toBe(true);
    expect(output.outputSegments).toStrictEqual([
      { text: output.unicodeText, unmapped: false, sourceIndex: 0 },
    ]);
  });
});
