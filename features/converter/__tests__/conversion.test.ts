import { describe, expect, it } from "vitest";
import { convertLegacyText, convertDocument, detectEncoding } from "../engine/pipeline";
import { MIN_DETECTION_CONFIDENCE } from "../engine/detectEncoding";
import { bijoyFixtures } from "./bijoy.fixtures";
import { sutonnyFixtures } from "./sutonny.fixtures";
import { alphaAnsiFixtures } from "./alphaAnsi.fixtures";

describe("convertLegacyText — bijoy", () => {
  for (const fixture of bijoyFixtures) {
    it(fixture.description, () => {
      const result = convertLegacyText(fixture.input, "bijoy");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.unicodeText).toBe(fixture.expected);
      }
    });
  }
});

describe("convertLegacyText — sutonny", () => {
  for (const fixture of sutonnyFixtures) {
    it(fixture.description, () => {
      const result = convertLegacyText(fixture.input, "sutonny");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.unicodeText).toBe(fixture.expected);
      }
    });
  }
});

describe("convertLegacyText — alpha-ansi", () => {
  for (const fixture of alphaAnsiFixtures) {
    it(fixture.description, () => {
      const result = convertLegacyText(fixture.input, "alpha-ansi");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.unicodeText).toBe(fixture.expected);
      }
    });
  }
});

describe("convertLegacyText — edge cases", () => {
  it("returns an empty string for empty input, never throws", () => {
    const result = convertLegacyText("", "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe("");
  });

  it("flags an unknown character as unmapped instead of dropping it", () => {
    const result = convertLegacyText("K@L", "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.unicodeText).toBe("ক@খ");
      expect(result.value.validation.valid).toBe(false);
      expect(result.value.validation.unmappedSequences).toContain("@");
    }
  });

  it("does not flag whitespace as unmapped", () => {
    const result = convertLegacyText("K L", "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.validation.valid).toBe(true);
  });

  it("mixed Bengali-glyph and digit/punctuation content converts each independently", () => {
    // Note: Bijoy/SutonnyMJ remap the *entire* ASCII letter range to Bengali
    // glyphs (that's the whole mechanism these encodings rely on), so plain
    // English words typed in a Bijoy-encoded document are not distinguishable
    // from Bengali glyph sequences at this layer — that requires font-run
    // detection, which is out of scope for the tokenizer. Digits and
    // punctuation, however, are unambiguous and should convert/pass through
    // independently of the surrounding Bengali text.
    const result = convertLegacyText("K 123 L!", "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe("ক ১২৩ খ!");
  });

  it("handles large input without throwing (perf smoke test)", () => {
    const large = "K&Lv wK©".repeat(5000);
    expect(() => convertLegacyText(large, "bijoy")).not.toThrow();
  });

  it("rejects an unregistered encoding id with a typed validation error", () => {
    const result = convertLegacyText("K", "not-a-real-encoding");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("convertDocument", () => {
  it("converts already-extracted text through the same pipeline", () => {
    const result = convertDocument({ extractedText: "K", encodingId: "bijoy" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe("ক");
  });

  it("returns a typed FileProcessingError for empty extracted text", () => {
    const result = convertDocument({ extractedText: "   ", encodingId: "bijoy" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
      if (result.error.code === "FILE_PROCESSING_ERROR") {
        expect(result.error.details?.reason).toBe("empty");
      }
    }
  });
});

describe("detectEncoding", () => {
  it("picks bijoy for bijoy-shaped input over sutonny", () => {
    const detection = detectEncoding("Av K L M N");
    expect(detection.encodingId).toBe("bijoy");
  });

  it("reports zero confidence for input with no non-whitespace characters", () => {
    const detection = detectEncoding("   ");
    expect(detection.confidence).toBe(0);
  });

  it("picks alpha-ansi, not bijoy, for an alpha-ANSI document", () => {
    const detection = detectEncoding(alphaAnsiFixtures.at(-1)!.input);
    expect(detection.encodingId).toBe("alpha-ansi");
  });

  it("scores bijoy's legacy-range coverage low on an alpha-ANSI document", () => {
    const detection = detectEncoding(alphaAnsiFixtures.at(-1)!.input);
    const bijoy = detection.scores.find((score) => score.encodingId === "bijoy")!;
    expect(bijoy.legacyRangeCoverage).toBeLessThan(0.3);
  });

  it("returns no encoding when nothing clears the confidence floor", () => {
    const detection = detectEncoding("¡¢£¤¥§ª®−ÑÉÐ".repeat(3));
    const best = detection.scores.find((score) => score.encodingId === "bijoy")!;
    expect(best.confidence).toBeLessThan(MIN_DETECTION_CONFIDENCE);
  });
});
