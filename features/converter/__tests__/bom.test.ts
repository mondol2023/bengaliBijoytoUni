import { describe, expect, it } from "vitest";
import { convertLegacyText, convertDocument } from "../engine/pipeline";
import { stripBom } from "../engine/normalize";
import { listEncodings } from "../encodings/registry";
import { buildFailureOccurrence } from "@/lib/conversionFailures/occurrence";

const BOM = "\uFEFF";

/**
 * E3. A BOM survives copy/paste out of a Windows-exported file and out of
 * some PDF extractors. No rule table has an entry for U+FEFF, so it reached
 * `tokenize` as an unmapped character: a warning on the first character of
 * an otherwise perfect conversion, plus a junk `failurePatterns` row.
 */
describe("BOM at the input boundary", () => {
  const input = "Av Kv wK";
  const expected = "আ কা কি";

  it("converts BOM-prefixed text identically to clean text", () => {
    const withBom = convertLegacyText(BOM + input, "bijoy");
    const without = convertLegacyText(input, "bijoy");

    expect(withBom.ok).toBe(true);
    if (withBom.ok && without.ok) {
      expect(withBom.value.unicodeText).toBe(expected);
      expect(withBom.value.unicodeText).toBe(without.value.unicodeText);
    }
  });

  it("raises no unmapped-character warning for the BOM", () => {
    const result = convertLegacyText(BOM + input, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.validation.unmappedDetails).toEqual([]);
      expect(result.value.validation.unmappedSequences).toEqual([]);
      expect(result.value.validation.valid).toBe(true);
    }
  });

  it("leaves no U+FEFF in the converted output", () => {
    const result = convertLegacyText(BOM + input, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).not.toContain(BOM);
  });

  it("applies to every registered encoding, not just bijoy", () => {
    for (const encoding of listEncodings()) {
      const result = convertLegacyText(BOM + "0123", encoding.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.unicodeText).toBe("০১২৩");
        expect(result.value.validation.unmappedDetails).toEqual([]);
      }
    }
  });

  it("applies on the document path too", () => {
    const result = convertDocument({ extractedText: BOM + input, encodingId: "bijoy" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe(expected);
  });
});

describe("offsets stay aligned after hygiene", () => {
  /**
   * The regression this guards: hygiene shifts every offset by the length of
   * what it removed. A reporter that windows the *raw* input with a
   * post-hygiene offset produces an off-by-one context window and stores a
   * wrong `position`, so `ConversionOutput.sourceText` exists to be the one
   * string those offsets index into.
   */
  const unmapped = "\u0001";
  const raw = `${BOM}Av ${unmapped} Kv`;

  it("exposes the hygiene-applied input as sourceText", () => {
    const result = convertLegacyText(raw, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceText).toBe(stripBom(raw));
      expect(result.value.sourceText.startsWith(BOM)).toBe(false);
    }
  });

  it("reports a position that indexes into sourceText, not the raw input", () => {
    const result = convertLegacyText(raw, "bijoy");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detail = result.value.validation.unmappedDetails.find((d) => d.sequence === unmapped);
    expect(detail).toBeDefined();
    const position = detail!.positions[0]!;
    expect(result.value.sourceText[position]).toBe(unmapped);
    // The same index into the raw input would land one character early.
    expect(raw[position]).not.toBe(unmapped);
  });

  it("windows the correct context when the reporter uses sourceText", () => {
    const result = convertLegacyText(raw, "bijoy");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detail = result.value.validation.unmappedDetails.find((d) => d.sequence === unmapped)!;
    const built = buildFailureOccurrence(
      {
        source: "text",
        encodingId: "bijoy",
        engineVersion: result.value.engineVersion,
        rulesHash: result.value.rulesHash,
      },
      result.value.sourceText,
      detail,
    );

    expect(built.contextBefore).toBe("Av ");
    expect(built.contextAfter).toBe(" Kv");
  });
});

describe("interior U+FEFF", () => {
  /**
   * Removed too, and not only for consistency: JavaScript's `\s` matches
   * U+FEFF, so `validateTokens` skipped it as whitespace and it passed
   * silently into the converted output — an invisible character in text the
   * user is about to paste somewhere that cares.
   */
  it("is removed from the source", () => {
    expect(stripBom(`Av${BOM}Kv`)).toBe("AvKv");
  });

  it("no longer leaks into the converted output", () => {
    const result = convertLegacyText(`Av${BOM}Kv`, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.unicodeText).toBe("আকা");
      expect(result.value.unicodeText).not.toContain(BOM);
    }
  });

  it("raises no warning, since there is nothing ambiguous to report", () => {
    const result = convertLegacyText(`Av${BOM}Kv`, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.validation.warnings).toEqual([]);
  });
});

describe("stripBom", () => {
  it("removes every BOM, not just the first", () => {
    expect(stripBom(`${BOM}${BOM}x`)).toBe("x");
  });

  it("is a no-op on text that has none", () => {
    expect(stripBom("Av")).toBe("Av");
  });

  it("handles the empty string", () => {
    expect(stripBom("")).toBe("");
  });
});
