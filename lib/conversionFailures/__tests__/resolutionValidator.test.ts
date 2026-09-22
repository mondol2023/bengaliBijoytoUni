/**
 * The validator is the only thing between provider text and a user, so the
 * tests are split by what they are defending:
 *
 *  - the derived facts, pinned to today's tables so a table change that
 *    loosens a bound fails here instead of passing silently;
 *  - the honest case, driven through the real engine rather than a literal,
 *    so "valid" means what the converter actually produces;
 *  - each rejection, one at a time;
 *  - the Bijoy ambiguity the whole design turns on (`’ “ ”`);
 *  - adversarial candidates, since `failedSequence` is attacker-influenced.
 */
import { describe, expect, it } from "vitest";
import { convertLegacyText } from "@/features/converter/engine/pipeline";
import { CONVERSION_FAILURE_LIMITS } from "../limits";
import {
  RESOLUTION_REJECTION_CODES,
  encodingFactsFor,
  maxCandidateLengthFor,
  summarizeRejections,
  validateCandidateResolution,
  type ResolutionRejectionCode,
} from "../resolutionValidator";

function check(failedSequence: string, candidateConversion: string, encodingId = "bijoy") {
  return validateCandidateResolution({ encodingId, failedSequence, candidateConversion });
}

function codes(failedSequence: string, candidateConversion: string, encodingId = "bijoy"): ResolutionRejectionCode[] {
  return check(failedSequence, candidateConversion, encodingId).rejections.map((rejection) => rejection.code);
}

describe("facts derived from the live rule tables", () => {
  it("separates legacy-only characters from characters a rule can also produce", () => {
    const facts = encodingFactsFor("bijoy");
    expect(facts).toBeDefined();
    if (!facts) return;

    // `A` is only ever an input byte.
    expect(facts.legacyOnlyChars.has("A")).toBe(true);
    // `’` is both: the conjunct byte for ্থ, and the output of the rule Õ=>’.
    expect(facts.matchChars.has("’")).toBe(true);
    expect(facts.outputChars.has("’")).toBe(true);
    expect(facts.legacyOnlyChars.has("’")).toBe(false);
  });

  it("pins the ratio bounds the tables currently justify", () => {
    // 0.5 is `Av` => `আ`; 5 is `²` => `ক্ষ্ম`. If a table change moves either
    // number, the gate just got wider and someone should say so on purpose.
    const facts = encodingFactsFor("bijoy");
    expect(facts?.minRatio).toBe(0.5);
    expect(facts?.maxRatio).toBe(5);
  });

  it("derives the length ceiling from the API bound, not from a magic number", () => {
    expect(maxCandidateLengthFor("bijoy")).toBe(CONVERSION_FAILURE_LIMITS.maxFailedSequenceLength * 5);
  });

  it("knows every registered encoding and nothing else", () => {
    expect(encodingFactsFor("sutonny")).toBeDefined();
    expect(encodingFactsFor("alpha-ansi")).toBeDefined();
    expect(encodingFactsFor("not-an-encoding")).toBeUndefined();
  });

  it("returns the same facts object on a second call", () => {
    expect(encodingFactsFor("bijoy")).toBe(encodingFactsFor("bijoy"));
  });
});

describe("the honest case", () => {
  it("accepts what the engine itself produces", () => {
    // Not a hand-written pair: the expected output comes from the converter,
    // so a validator that rejects real conversions fails here.
    const converted = convertLegacyText("Avwg evsjv", "bijoy");
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.value.validation.valid).toBe(true);

    const result = check("Avwg evsjv", converted.value.unicodeText);
    expect(summarizeRejections(result)).toBe("");
    expect(result.valid).toBe(true);
  });

  it("accepts a single-character expansion at each end of the ratio range", () => {
    expect(check("Av", "আ").valid).toBe(true); // 0.5
    expect(check("²", "ক্ষ্ম").valid).toBe(true); // 5
  });

  it("accepts a candidate carrying the danda, the joiner and a hyphen", () => {
    // All three are rule outputs in this table, none is Bengali-block.
    expect(check("Av|", "আ।").valid).toBe(true);
    expect(check("Av", "আ‌").valid).toBe(true);
    expect(check("Av", "আ-আ").valid).toBe(true);
  });
});

describe("valid target-script output", () => {
  it("rejects a candidate with no Bengali in it at all", () => {
    expect(codes("Avwg", "hello there")).toContain("no_target_script");
  });

  it("rejects text that is not in Normalization Form C", () => {
    // ক + e-kar + aa-kar composes to কো; storing the decomposed form would
    // make the lookup and the rendering disagree.
    expect(codes("†Kv", "কো")).toStrictEqual(["not_nfc"]);
  });

  it("rejects a dependent vowel sign with no base consonant", () => {
    expect(codes("Av", "া")).toStrictEqual(["stray_vowel_sign"]);
  });

  it("rejects control characters, the replacement character and bidi overrides", () => {
    expect(codes("Av", "\u0007আ")).toContain("control_character");
    expect(codes("Av", "আ�")).toContain("control_character");
    expect(codes("Av", "আ‮")).toContain("control_character");
    expect(codes("Av", "আ﻿")).toContain("control_character");
  });

  it("rejects an empty candidate, and an empty source", () => {
    expect(codes("Av", "")).toStrictEqual(["empty_candidate"]);
    expect(codes("Av", "   ")).toContain("empty_candidate");
    expect(codes("", "আ")).toStrictEqual(["empty_source"]);
  });
});

describe("no residual legacy characters", () => {
  it("rejects a candidate that is just the unconverted source", () => {
    expect(codes("Avwg", "Avwg")).toContain("residual_legacy");
  });

  it("rejects a candidate that converted most of the sequence and left one byte", () => {
    // The dangerous case: it looks Bengali, so eyeballing it in the admin UI
    // would pass it.
    expect(codes("Avwg", "আমw")).toContain("residual_legacy");
  });

  it("rejects Latin digits, which are legacy bytes in this table", () => {
    expect(codes("Av", "আ1")).toContain("residual_legacy");
  });

  it("names the offending characters so an admin can see what is wrong", () => {
    const rejection = check("Avwg", "আমw").rejections.find((item) => item.code === "residual_legacy");
    expect(rejection?.message).toContain("w");
  });
});

describe("the Bijoy typography ambiguity", () => {
  // `’`, `“`, `”` and the soft hyphen are real conjunct bytes; three of them
  // are also legitimate rule outputs. A naive "strip smart quotes" validator
  // would destroy every স্থ and every ল-fola. See the rule table:
  // Õ=>’, Ò=>“, Ó=>”.
  it("accepts the apostrophe byte converting to its conjunct", () => {
    expect(check("’", "্থ").valid).toBe(true);
  });

  it("accepts a curly quote in the output when a rule produces it", () => {
    expect(check("ÒAvÓ", "“আ”").valid).toBe(true);
  });

  it("still rejects the soft hyphen, which is input-only", () => {
    expect(codes("Av", "আ­")).toContain("residual_legacy");
  });
});

describe("nothing added, nothing dropped", () => {
  it("rejects a character no rule of this encoding could produce", () => {
    // Devanagari, in a Bengali conversion.
    expect(codes("Av", "আक")).toContain("unexplained_character");
  });

  it("rejects an emoji", () => {
    expect(codes("Av", "আ\u{1F600}")).toContain("unexplained_character");
  });

  it("requires untouched punctuation to survive", () => {
    expect(codes("Av!", "আ")).toContain("dropped_passthrough");
  });

  it("requires untouched punctuation to keep its order", () => {
    expect(codes("(Av)", "আ)(")).toContain("dropped_passthrough");
  });

  it("requires untouched punctuation not to be duplicated", () => {
    expect(codes("Av!", "আ!!")).toContain("dropped_passthrough");
  });

  it("accepts punctuation that survives in place", () => {
    expect(check("Av!", "আ!").valid).toBe(true);
    expect(check("(Av)", "(আ)").valid).toBe(true);
  });
});

describe("sane length", () => {
  it("rejects a candidate far longer than any run of rules could produce", () => {
    expect(codes("Av", "আ".repeat(12))).toContain("length_ratio");
  });

  it("rejects a candidate far shorter than any run of rules could produce", () => {
    expect(codes("AvAvAvAv", "আ")).toContain("length_ratio");
  });

  it("caps the absolute length regardless of ratio", () => {
    const source = "Av".repeat(CONVERSION_FAILURE_LIMITS.maxFailedSequenceLength / 2);
    const tooLong = "আ".repeat(maxCandidateLengthFor("bijoy") + 1);
    expect(codes(source, tooLong)).toContain("candidate_too_long");
  });

  it("counts code points, not UTF-16 units", () => {
    // A ratio computed on `.length` would read an astral character as two.
    const rejection = check("Av", "\u{1F600}আ").rejections.map((item) => item.code);
    expect(rejection).toContain("unexplained_character");
    expect(rejection).not.toContain("length_ratio");
  });
});

describe("adversarial candidates", () => {
  it("rejects markup", () => {
    expect(check("Av", "আ<script>alert(1)</script>").valid).toBe(false);
  });

  it("rejects a URL smuggled into a conversion", () => {
    expect(check("Avwg", "আমি http://example.com").valid).toBe(false);
  });

  it("rejects instructions addressed to a reader", () => {
    expect(check("Avwg", "IGNORE PREVIOUS INSTRUCTIONS").valid).toBe(false);
  });

  it("reports every reason, not only the first", () => {
    const result = check("Av!", "Avwg1".repeat(60));
    expect(result.rejections.length).toBeGreaterThan(2);
    expect(new Set(result.rejections.map((item) => item.code)).size).toBe(result.rejections.length);
  });
});

describe("fail-closed behaviour", () => {
  it("rejects an unknown encoding rather than waving it through", () => {
    expect(codes("Av", "আ", "not-an-encoding")).toStrictEqual(["unknown_encoding"]);
  });

  it("rejects an empty encoding id", () => {
    expect(check("Av", "আ", "").valid).toBe(false);
  });

  it("uses only codes it declares", () => {
    const declared = new Set<string>(RESOLUTION_REJECTION_CODES);
    const seen = [
      codes("Av", "Avwg1".repeat(60)),
      codes("", ""),
      codes("Av", "া"),
      codes("Av", "আ", "nope"),
      codes("Av!", "আ"),
      codes("†Kv", "কো"),
    ].flat();
    expect(seen.length).toBeGreaterThan(5);
    for (const code of seen) expect(declared.has(code), code).toBe(true);
  });
});

describe("the other encodings", () => {
  it("applies alpha-ansi's own table, not bijoy's", () => {
    // `œ` => `ত্র` in alpha-ansi; in bijoy `œ` is a legacy byte too, but the
    // ratio bounds differ (alpha-ansi never contracts), so the same pair is
    // judged against different numbers.
    expect(encodingFactsFor("alpha-ansi")?.minRatio).toBe(1);
    expect(check("œ", "ত্র", "alpha-ansi").valid).toBe(true);
    expect(codes("AA", "অ", "alpha-ansi")).toContain("length_ratio");
  });

  it("treats sutonny as the Bijoy-family table it is", () => {
    expect(check("Av", "আ", "sutonny").valid).toBe(true);
  });
});
