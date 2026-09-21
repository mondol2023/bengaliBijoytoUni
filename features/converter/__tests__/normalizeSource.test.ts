import { describe, expect, it } from "vitest";
import { normalizeSource } from "../engine/normalizeSource";
import { convertLegacyText } from "../engine/pipeline";
import { getEncoding } from "../encodings/registry";
import { buildSignalOccurrence } from "@/lib/conversionFailures/occurrence";

const bijoy = getEncoding("bijoy")!;
const alphaAnsi = getEncoding("alpha-ansi")!;

const APOSTROPHE = "\u2019"; // ’ — also Bijoy's ্থ
const SOFT_HYPHEN = "\u00AD"; // also Bijoy's ্ল
const LEGACY = "wkÿv †evW© Kw¤úDUvi";
const MIXED = `${LEGACY} ${APOSTROPHE} শিক্ষা`;

/**
 * E2. These tables address CP1252 bytes, and several of those bytes are
 * Latin typography characters carrying real conjuncts: in Bijoy U+2019 is
 * ্থ, U+00AD is ্ল, U+201C is ু and U+201D heads the চ্ series. A routine
 * "smart quotes" or "strip soft hyphens" cleanup would silently destroy
 * every স্থ and every ল-fola. So the hygiene pass flags and never changes
 * them.
 */
describe("normalizeSource — flag, never strip", () => {
  it("returns the text byte-for-byte unchanged apart from the BOM", () => {
    expect(normalizeSource(MIXED, bijoy).text).toBe(MIXED);
    expect(normalizeSource(`\uFEFF${MIXED}`, bijoy).text).toBe(MIXED);
  });

  it("keeps the ambiguous character in the text it hands the tokenizer", () => {
    expect(normalizeSource(MIXED, bijoy).text).toContain(APOSTROPHE);
  });

  it("flags it, naming what it converts to", () => {
    const [signal] = normalizeSource(MIXED, bijoy).signals;
    expect(signal.sequence).toBe(APOSTROPHE);
    expect(signal.unicode).toBe("্থ");
    expect(signal.count).toBe(1);
    expect(signal.positions[0]).toBe(MIXED.indexOf(APOSTROPHE));
  });

  it("flags the soft hyphen, the one most likely to be stripped by accident", () => {
    const text = `${LEGACY} ${SOFT_HYPHEN} শিক্ষা`;
    const [signal] = normalizeSource(text, bijoy).signals;
    expect(signal.sequence).toBe(SOFT_HYPHEN);
    expect(signal.unicode).toBe("্ল");
  });
});

describe("normalizeSource — only where the ambiguity is real", () => {
  it("says nothing about pure legacy text, where the byte is unambiguous", () => {
    expect(normalizeSource(`${LEGACY} ${APOSTROPHE}`, bijoy).signals).toEqual([]);
  });

  it("says nothing when the encoding does not map the character at all", () => {
    expect(normalizeSource(MIXED, alphaAnsi).signals).toEqual([]);
  });

  it("says nothing about text with no ambiguous characters", () => {
    expect(normalizeSource(`${LEGACY} শিক্ষা`, bijoy).signals).toEqual([]);
  });

  it("orders the most frequent first", () => {
    const text = `${LEGACY} ${SOFT_HYPHEN} ${APOSTROPHE} ${SOFT_HYPHEN} শিক্ষা`;
    const signals = normalizeSource(text, bijoy).signals;
    expect(signals[0].sequence).toBe(SOFT_HYPHEN);
    expect(signals[0].count).toBe(2);
  });
});

describe("the conversion itself is untouched", () => {
  it("still converts the ambiguous byte to its conjunct", () => {
    const result = convertLegacyText(MIXED, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.unicodeText).toContain("্থ");
      expect(result.value.validation.sourceSignals).toHaveLength(1);
    }
  });

  it("still converts স্থ correctly in ordinary legacy text", () => {
    const result = convertLegacyText("¯’vb", "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe("স্থান");
  });

  it("does not let a signal make the conversion invalid on its own", () => {
    const result = convertLegacyText(MIXED, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Mixed content is invalid because the Bengali letters are unmapped,
      // not because a byte was flagged — the signal is advisory.
      expect(result.value.validation.unmappedSequences.length).toBeGreaterThan(0);
      expect(result.value.validation.sourceSignals.length).toBeGreaterThan(0);
    }
  });

  it("defers to the already-Unicode guard when the text is mostly Bengali", () => {
    const result = convertLegacyText(`শিক্ষা বোর্ড ${APOSTROPHE} হতে`, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.validation.alreadyUnicode).toBe(true);
      expect(result.value.validation.sourceSignals).toEqual([]);
    }
  });
});

describe("signals are recorded as reviewable patterns", () => {
  it("builds an occurrence in its own category, under the same privacy bound", () => {
    const result = convertLegacyText(MIXED, "bijoy");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const occurrence = buildSignalOccurrence(
      {
        source: "text",
        encodingId: "bijoy",
        engineVersion: result.value.engineVersion,
        rulesHash: result.value.rulesHash,
      },
      result.value.sourceText,
      result.value.validation.sourceSignals[0],
    );

    expect(occurrence.failureCategory).toBe("ambiguous_typography");
    expect(occurrence.errorCode).toBe("AMBIGUOUS_TYPOGRAPHY");
    expect(occurrence.failedSequence).toBe(APOSTROPHE);
    expect(occurrence).not.toHaveProperty("fullText");
    expect(occurrence.engineOutput).toBeNull();
    expect(occurrence.contextBefore.length).toBeLessThanOrEqual(80);
  });

  it("surfaces the explanation to the user as a warning", () => {
    const result = convertLegacyText(MIXED, "bijoy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value.validation.warnings.some((w) => w.includes("is both Latin punctuation and a legacy byte")),
      ).toBe(true);
    }
  });
});
