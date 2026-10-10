import { describe, expect, it } from "vitest";
import { convertLegacyText } from "../engine/pipeline";
import { listEncodings } from "../encodings/registry";
import { getEncoding } from "../encodings/registry";
import { tokenize } from "../engine/tokenize";

const DANDA = "।";
const DOUBLE_DANDA = "॥";

/**
 * U+0964/U+0965 are the Bengali danda, but Unicode puts them in the
 * Devanagari block, so neither the shared-punctuation list nor a Bengali-block
 * check covered them. A pasted or mixed-in `।` was filed as "had no mapping
 * rule" — a row no mapping could ever resolve.
 */
describe.each([
  ["danda", DANDA],
  ["double danda", DOUBLE_DANDA],
])("%s passthrough", (_name, mark) => {
  it("tokenizes as expected passthrough, not an unmapped token", () => {
    const token = tokenize(`Av${mark}`, getEncoding("bijoy")!).find((t) => t.legacy === mark);
    expect(token).toBeDefined();
    expect(token!.unmapped).toBeUndefined();
    expect(token!.unicode).toBe(mark);
  });

  it("is not reported as unmapped, and survives unchanged, in every encoding", () => {
    for (const encoding of listEncodings()) {
      const result = convertLegacyText(`0${mark}1`, encoding.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.validation.unmappedSequences).toEqual([]);
        expect(result.value.validation.unmappedDetails).toEqual([]);
        expect(result.value.unicodeText).toBe(`০${mark}১`);
      }
    }
  });
});

describe("the legacy danda byte still converts", () => {
  it("keeps Bijoy | = ।", () => {
    const result = convertLegacyText("Av|", "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe("আ।");
  });
});
