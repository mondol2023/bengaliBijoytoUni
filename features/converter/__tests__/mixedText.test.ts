/**
 * Pasted text that mixes the alphabetic ANSI layout and Bijoy.
 *
 * The strings are lines of two real Bangladeshi High Court criminal-appeal
 * judgments, pasted as text: page headers and some whole pages set in
 * alpha-ANSI, the body in Bijoy. Run through one table the result was
 * 1,870 unmapped characters and, for the other font's lines, gibberish
 * ("q¡C−L¡VÑ" → "য়¡ঈ্লখ¡ঠ-"). The expected Bengali was checked word by word
 * against an independent transcription of the same judgment.
 */
import { describe, expect, it } from "vitest";
import { convertMixedLegacy, splitMixedLegacy } from "../engine/mixedText";
import { convertLegacyText } from "../engine/pipeline";

function mixed(text: string) {
  const result = convertMixedLegacy(text);
  if (result === null) throw new Error("expected a mixed-font split");
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function single(encodingId: string, text: string) {
  const result = convertLegacyText(text, encodingId);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("splitMixedLegacy", () => {
  it("splits an alpha-ANSI page header from the Bijoy body under it", () => {
    const output = mixed(
      [
        "q¡C−L¡VÑ ®g±Sc¡l£ glj ew- 6",
        "eðl ................................ 20",
        "œ²¢jL ew −e¡V J B−cn",
        "",
        "†nv‡mb weMZ 03/10/90 wLªt ZvwiL nB‡Z PÆMÖvg kni¯’ nvwjkni",
        "†K›`ªxq Lv`¨ ¸`v‡gi 25bs ¸`v‡gi fvicÖvß Kg©KZ©v wnmv‡e Kg©iZ",
      ].join("\r\n"),
    );
    expect(output.unicodeText.split("\r\n")).toEqual([
      "হাইকোর্ট ফৌজদারী ফরম নং- ৬",
      "নম্বর ................................ ২০",
      "ক্রমিক নং নোট ও আদেশ",
      "",
      "হোসেন বিগত ০৩/১০/৯০ খ্রিঃ তারিখ হইতে চট্টগ্রাম শহরস্থ হালিশহর",
      "কেন্দ্রীয় খাদ্য গুদামের ২৫নং গুদামের ভারপ্রাপ্ত কর্মকর্তা হিসাবে কর্মরত",
    ]);
    expect(output.validation.unmappedSequences).toEqual([]);
    expect(Object.keys(output.convertedChars).sort()).toEqual(["alpha-ansi", "bijoy"]);
  });

  it("switches font in the middle of a line at a double space", () => {
    const output = mixed(
      "A¢i−k¡N fËc¡e L−lez Ae¤¢mMe qmx a¡¢l−Ml l¡u ¢e−jÀ A¢hLm Ae¤¢mMe qmx  cÖwmwKDkb c‡¶i †gvKÏgv ms‡¶‡c GB Avmvgx †gvt ev‡iK",
    );
    expect(output.unicodeText).toBe(
      "অভিযোগ প্রদান করেন। অনুলিখন হলঃ তারিখের রায় নিম্নে অবিকল অনুলিখন হলঃ  প্রসিকিউশন পক্ষের মোকদ্দমা সংক্ষেপে এই আসামী মোঃ বারেক",
    );
  });

  it("rejoins to the input exactly", () => {
    const text = "q¡C−L¡VÑ ®g±Sc¡l£ glj\r\n†nv‡mb weMZ  nB‡Z PÆMÖvg";
    expect(splitMixedLegacy(text)?.map((run) => run.text).join("")).toBe(text);
  });

  it("leaves single-font and non-Bengali text to the ordinary path", () => {
    expect(splitMixedLegacy("†nv‡mb weMZ 03/10/90 wLªt ZvwiL nB‡Z PÆMÖvg kni¯’ nvwjkni")).toBeNull();
    expect(splitMixedLegacy("Bf£mL¡l£ ®j¡x h¡−lL ®q¡−pe Q–NË¡j q¡¢mnql ®L¾cÐ£u M¡cÉ")).toBeNull();
    expect(splitMixedLegacy("Call for the records and issue a Rule calling")).toBeNull();
    expect(splitMixedLegacy("")).toBeNull();
  });

  it("treats one word the other table reads as a gap in the table, not a change of font", () => {
    // "Eá¤a" (উদ্ভূত): alpha-ANSI has no rule for "á", Bijoy does. Following
    // that one word into Bijoy would garble it; the line stays alpha-ANSI.
    expect(splitMixedLegacy("Bf£mL¡l£ ®j¡x h¡−lL ®q¡−pe Q–NË¡j q¡¢mnql ®L¾cÐ£u M¡cÉ …c¡−jl Eá¤a")).toBeNull();
  });
});

describe("Bijoy words typed half in the other layout", () => {
  it("reads BaÈ as আত্ম, the alpha-ANSI start of আত্মসাৎকৃত", () => {
    expect(single("bijoy", "BaÈmvrK…Z").unicodeText).toBe("আত্মসাৎকৃত");
  });

  it("reads ¥ after Z as ম-fola, as it is after a, b and Y", () => {
    expect(single("bijoy", "AvZ¥mvr AvZ¥mv‡Zi").unicodeText).toBe("আত্মসাৎ আত্মসাতের");
  });

  it("reads Í after ¯ as the ্ত a PDF copy hands over", () => {
    expect(single("bijoy", "ev¯Íe e¯Ív").unicodeText).toBe("বাস্তব বস্তা");
  });
});

describe("U+2018 inside a Bijoy word", () => {
  it("is ্তু when glued to the letter before it", () => {
    const output = single("bijoy", "wKš‘ cÖ¯‘Z Amš‘ó");
    expect(output.unicodeText).toBe("কিন্তু প্রস্তুত অসন্তুষ্ট");
    expect(output.validation.unmappedSequences).toEqual([]);
  });

  it("stays a quotation mark when it opens a word", () => {
    expect(single("bijoy", "‘evsjv’").unicodeText.startsWith("‘")).toBe(true);
  });

  it("stays জ্ঞ in alpha-ANSI", () => {
    expect(single("alpha-ansi", "¢h‘").unicodeText).toBe("বিজ্ঞ");
  });
});

describe("alpha-ANSI bytes seen in the same judgments", () => {
  it("reads Ã as the half form প্", () => {
    expect(single("alpha-ansi", "®p−ÃVðl").unicodeText).toBe("সেপ্টেম্বর");
  });

  it("reads Q– as চট্ট and …c as গুদ, leaving a bare dash and ellipsis alone", () => {
    expect(single("alpha-ansi", "Q–NË¡j …c¡−jl").unicodeText).toBe("চট্টগ্রাম গুদামের");
    expect(single("alpha-ansi", "Hhw… 2020 – 2021").unicodeText).toBe("এবং… ২০২০ – ২০২১");
  });
});
