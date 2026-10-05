import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkSpelling } from "../spelling/checkSpelling";
import { createSpellChecker, ENGLISH_DICTIONARIES, loadEnglishSpellChecker } from "../spelling/loadChecker";
import type { SpellChecker } from "../spelling/types";

/**
 * Against the real shipped dictionaries (`public/dictionaries/en-gb` + `en`), for what a
 * fake cannot prove: that the bundled files load, that ordinary and
 * inflected English is accepted, and that the document-shaped text this tool
 * is used on produces no noise.
 */
const read = (dir: string, file: string) =>
  readFileSync(path.join(process.cwd(), "public", "dictionaries", dir, file), "utf8");
const load = (dir: string) => ({ aff: read(dir, `${dir}.aff`), dic: read(dir, `${dir}.dic`) });

let checker: SpellChecker;
beforeAll(() => {
  checker = createSpellChecker(load("en-gb"), load("en"));
});

const flagged = (text: string) => checkSpelling(text, checker).misspellings.map((m) => m.word);

describe("shipped English dictionary", () => {
  it("flags common typos and suggests the fix", () => {
    expect(flagged("Please recieve the payment and teh receipt.")).toEqual(["recieve", "teh"]);
    expect(checker.suggest("recieve")).toContain("receive");
  });

  it("puts the fix for swapped letters first, where Hunspell alone buries it", () => {
    expect(checker.suggest("teh")[0]).toBe("the");
    expect(checker.suggest("recieve")[0]).toBe("receive");
    expect(checker.suggest("Recieve")[0]).toBe("Receive");
    expect(checker.suggest("recieve").length).toBeLessThanOrEqual(3);
  });

  it("accepts both British and US spellings", () => {
    expect(flagged("colour color behaviour behavior organisation organization judgement judgment cheque check")).toEqual([]);
  });

  it("accepts ordinary and inflected English", () => {
    expect(flagged("The plaintiffs walked quickly, and the defendant's lawyers reviewed documents carefully.")).toEqual([]);
  });

  it("accepts a realistic case / bank / land-record text without noise", () => {
    const text = [
      "Title Suit No. 123/2020 before the Senior Assistant Judge, Dhaka.",
      "Plaintiff Md. Abdur Rahim Uddin vs Defendant Mst. Rokeya Begum, S/O Late Karim.",
      "Mouza: Savar, Thana: Savar, Dist: Dhaka. C.S. Khatian 45/B, R.S. Dag No. 1234/5678, B.S. Dag 99/A.",
      "Deed (dolil) no 4567/2019 registered at the Sub-Registry Office; area 12 decimal, 3 katha, Rs.5,00,000/-.",
      "Please credit A/C No. 0012-3456-7890 (L/C 55/2021) by cheque no. CHQ 889977 via NEFT or RTGS.",
      "Bill No. BR/2020/45, dated 12/05/2020, amount Taka 25,000/- paid in full.",
    ].join("\n");
    expect(flagged(text)).toEqual([]);
  });

  it("still catches typos hiding in that same kind of text", () => {
    const text = "Plaintiff filed the apeal on 12/05/2020 against the defendnt, Khatian 45/B, Dag No. 1234/5678.";
    expect(flagged(text)).toEqual(["apeal", "defendnt"]);
  });
});

describe("loadEnglishSpellChecker", () => {
  const fakeFetch = (async (url: string | URL | Request) => {
    const [, , dir, file] = String(url).split("/");
    return new Response(read(dir, file), { status: 200 });
  }) as typeof fetch;

  it("loads from the served URLs and returns a working checker", async () => {
    const loaded = await loadEnglishSpellChecker(fakeFetch);
    expect(loaded.correct("receive")).toBe(true);
    expect(loaded.correct("recieve")).toBe(false);
    expect(loaded.correct("colour")).toBe(true);
    expect(ENGLISH_DICTIONARIES.map((d) => d.id)).toEqual(["en-gb", "en"]);
  });

  it("shares one load between callers", async () => {
    const a = loadEnglishSpellChecker(fakeFetch);
    const b = loadEnglishSpellChecker(fakeFetch);
    expect(await a).toBe(await b);
  });
});
