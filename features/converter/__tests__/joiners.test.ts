import { describe, expect, it } from "vitest";
import { convertLegacyText } from "../engine/pipeline";
import { listEncodings } from "../encodings/registry";
import { tokenize } from "../engine/tokenize";
import { getEncoding } from "../encodings/registry";

const ZWNJ = "\u200C";
const ZWJ = "\u200D";

/**
 * E5. ZWNJ/ZWJ are not legacy bytes in any of these tables, so they fell
 * through to the "genuinely unrecognized" branch of `tokenize`: an unmapped
 * warning, `validation.valid === false`, and a `failurePatterns` row that no
 * mapping rule could ever resolve. They arrive whenever the input is not
 * purely legacy — mixed documents, or a re-paste of this converter's own
 * output, which emits U+200C itself for the visible hasant.
 */
describe.each([
  ["ZWNJ", ZWNJ],
  ["ZWJ", ZWJ],
])("%s passthrough", (_name, joiner) => {
  const input = `Av${joiner}Kv`;

  it("is not reported as an unmapped character", () => {
    const result = convertLegacyText(input, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.validation.unmappedSequences).toEqual([]);
      expect(result.value.validation.unmappedDetails).toEqual([]);
    }
  });

  it("no longer marks the whole conversion invalid", () => {
    const result = convertLegacyText(input, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.validation.valid).toBe(true);
      expect(result.value.validation.warnings).toEqual([]);
    }
  });

  it("survives into the output unchanged, rather than being stripped", () => {
    const result = convertLegacyText(input, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe(`আ${joiner}কা`);
  });

  it("tokenizes as an expected passthrough, not an unmapped token", () => {
    const tokens = tokenize(input, getEncoding("bijoy")!);
    const token = tokens.find((t) => t.legacy === joiner);
    expect(token).toBeDefined();
    expect(token!.unmapped).toBeUndefined();
    expect(token!.unicode).toBe(joiner);
  });

  it("behaves the same in every registered encoding", () => {
    for (const encoding of listEncodings()) {
      const result = convertLegacyText(`0${joiner}1`, encoding.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.validation.unmappedDetails).toEqual([]);
        expect(result.value.unicodeText).toBe(`০${joiner}১`);
      }
    }
  });
});

describe("the converter's own output re-pasted", () => {
  /**
   * `encodings/bijoy/rules.ts` emits hasant + ZWNJ for the visible hasant,
   * so this text is something the app itself produces. Round-tripping it
   * used to report the joiner it had just written as an unmapped failure.
   */
  it("does not flag the ZWNJ it emitted itself", () => {
    const first = convertLegacyText("j&d", "bijoy");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.unicodeText).toBe("ল্‌ফ");
    expect(first.value.unicodeText).toContain(ZWNJ);

    const second = convertLegacyText(first.value.unicodeText, "bijoy");
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.validation.unmappedSequences).not.toContain(ZWNJ);
    }
  });
});

describe("genuinely unmapped characters still report", () => {
  it("does not let the joiner exemption swallow a real failure", () => {
    const result = convertLegacyText(`Av${ZWNJ}\u0001Kv`, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.validation.unmappedSequences).toEqual(["\u0001"]);
      expect(result.value.validation.valid).toBe(false);
    }
  });
});
