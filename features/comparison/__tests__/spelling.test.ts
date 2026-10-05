import { describe, expect, it } from "vitest";
import { checkSpelling } from "../spelling/checkSpelling";
import type { SpellChecker } from "../spelling/types";

/** A tiny fake dictionary: the engine's rules are under test here, not Hunspell's coverage. */
const KNOWN = new Set(
  (
    "the cat sat on mat please receive payment account case number no dated and he she met went home today " +
    "will well known his her accept not for with hello world bank bill land plot and or was were this that " +
    "report submitted monday morning don't dog's students rahim's go there is are of to in a it section see plot"
  ).split(" "),
);

const fake: SpellChecker = {
  correct: (word) => KNOWN.has(word.toLowerCase()),
  suggest: () => [],
};

const flagged = (text: string) => checkSpelling(text, fake).misspellings.map((m) => m.word);

describe("checkSpelling — basics", () => {
  it("flags a misspelled word and reports offsets into the original text", () => {
    const text = "please recieve the payment";
    const { misspellings } = checkSpelling(text, fake);
    expect(misspellings).toHaveLength(1);
    expect(misspellings[0].word).toBe("recieve");
    expect(text.slice(misspellings[0].start, misspellings[0].end)).toBe("recieve");
  });

  it("is case-insensitive about known words", () => {
    expect(flagged("The CAT Sat On The Mat")).toEqual([]);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(checkSpelling("", fake)).toEqual({ skipped: null, misspellings: [], words: [] });
    expect(flagged("   \n\t ")).toEqual([]);
  });

  it("skips words shorter than three letters", () => {
    expect(flagged("zq xv ab")).toEqual([]);
  });

  it("handles apostrophes, including the typographic one", () => {
    expect(flagged("don't and don’t and dog's")).toEqual([]);
    expect(flagged("dont")).toEqual(["dont"]);
  });

  it("checks each part of a hyphenated word", () => {
    expect(flagged("well-known")).toEqual([]);
    expect(flagged("wel-known")).toEqual(["wel"]);
  });

  it("does not take surrounding punctuation or quotes into the word", () => {
    const text = `(“recieve”),`;
    const { misspellings } = checkSpelling(text, fake);
    expect(misspellings.map((m) => text.slice(m.start, m.end))).toEqual(["recieve"]);
  });

  it("counts repeated words and orders the summary by frequency", () => {
    const { words } = checkSpelling("teh recieve teh teh recieve wrld", fake);
    expect(words).toEqual([
      { word: "teh", count: 3 },
      { word: "recieve", count: 2 },
      { word: "wrld", count: 1 },
    ]);
  });
});

describe("checkSpelling — references, case numbers, bank bills, land records", () => {
  it.each([
    "123/2020",
    "45/B",
    "12/3",
    "Rs.5000/-",
    "A12",
    "No.123/2020,",
    "(123/2020)",
    "0012-3456-7890",
    "dated:12/05/2020",
    "3rd",
    "BR12345",
    "AB-123",
    "xyzq/2020",
    "Dagxq/12",
    "১২৩/২০২০",
  ])("never flags the reference %s", (reference) => {
    expect(flagged(reference)).toEqual([]);
    expect(flagged(`case no ${reference} was submitted`)).toEqual([]);
  });

  it.each(["A/C", "a/c", "C/O", "S/O", "W/O", "D/O", "L/C", "B/L", "T/T", "N/A", "n/a", "P/O"])(
    "never flags the slashed abbreviation %s",
    (code) => {
      expect(flagged(`${code} no`)).toEqual([]);
    },
  );

  it("still catches a real typo sitting next to references", () => {
    expect(flagged("please recieve 123/2020 and A/C 45/B teh payment")).toEqual(["recieve", "teh"]);
  });

  it("checks long words inside a letters-only slashed chunk, short ones are exempt", () => {
    expect(flagged("recieve/accept")).toEqual(["recieve"]);
    expect(flagged("his/her")).toEqual([]);
    expect(flagged("xq/yz")).toEqual([]);
  });

  it("skips a whole reference chunk but not the words around it", () => {
    expect(flagged("plot qwzx12/3 wrld")).toEqual(["wrld"]);
  });

  it("allowlists transliterated land, legal and banking vocabulary", () => {
    expect(
      flagged("khatian dag dolil mouza thana upazila cheque lakh crore taka bigha namjari mutation jamabandi"),
    ).toEqual([]);
    expect(flagged("Mouza Khatian Dag Cheque")).toEqual([]);
  });

  it("allowlist handles plurals and possessives of listed terms", () => {
    expect(flagged("khatians mouzas cheques")).toEqual([]);
  });

  it("skips URLs and email addresses", () => {
    expect(flagged("see www.exampl.com or http://exampl.org/pg and xyzq@exampl.com")).toEqual([]);
  });

  it("skips tokens containing underscores, backslashes and hashes", () => {
    expect(flagged("snake_cse C:\\Folderx #hashtagx")).toEqual([]);
  });
});

describe("checkSpelling — Bengali and mixed text", () => {
  it("flags English next to Bengali, never the Bengali", () => {
    expect(flagged("আমার সোনার বাংলা please recieve")).toEqual(["recieve"]);
  });

  it("skips Latin letters glued to Bengali characters", () => {
    expect(flagged("বাংলাrecieve recieveবাংলা")).toEqual([]);
  });

  it("skips Latin letters glued to accented letters", () => {
    expect(flagged("naïvx")).toEqual([]);
  });
});

describe("checkSpelling — acronyms, mixed case, names, noise", () => {
  it("skips mixed-case words and short ALL-CAPS acronyms", () => {
    expect(flagged("iPhone eBay McKinley NEFT RTGS TIN VAT")).toEqual([]);
  });

  it("flags a long ALL-CAPS word that is misspelled", () => {
    expect(flagged("RECIEVE the payment")).toEqual(["RECIEVE"]);
    expect(flagged("PLEASE RECEIVE")).toEqual([]);
  });

  it("treats a Capitalized word mid-sentence as a proper noun", () => {
    expect(flagged("he met Karim today")).toEqual([]);
  });

  it("treats a Capitalized word after an abbreviation as a proper noun", () => {
    expect(flagged("Mr. Karim went home")).toEqual([]);
    expect(flagged("Dr. Rahim went home")).toEqual([]);
  });

  it("flags an unknown Capitalized word that opens a sentence on its own", () => {
    expect(flagged("Recieve the payment.")).toEqual(["Recieve"]);
    expect(flagged("the cat sat. Recieve the payment.")).toEqual(["Recieve"]);
  });

  it("does not flag a name that opens a sentence next to another name", () => {
    expect(flagged("Karim Uddin went home.")).toEqual([]);
    expect(flagged("the case. Abdur Karim went home.")).toEqual([]);
  });

  it("does not flag a sentence-initial name used as a name elsewhere in the same text", () => {
    expect(flagged("Karim went home. he met Karim today.")).toEqual([]);
  });

  it("does not take a newline-opened name as a typo when it is a name elsewhere", () => {
    expect(flagged("he met Karim today\nKarim went home")).toEqual([]);
  });

  it("skips Roman numerals and repeated-letter noise, but only when the dictionary rejects them", () => {
    expect(flagged("section xii and zzzz and ooooo")).toEqual([]);
  });
});

describe("checkSpelling — legacy gate", () => {
  const LEGACY = "wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv wkÿv †evW© n‡Z";

  it("skips a side that is legacy Bengali, and says so", () => {
    const result = checkSpelling(LEGACY, fake);
    expect(result.skipped).toBe("legacy");
    expect(result.misspellings).toEqual([]);
    expect(result.words).toEqual([]);
  });

  it("does not skip ordinary English", () => {
    expect(checkSpelling("please recieve", fake).skipped).toBeNull();
  });
});
