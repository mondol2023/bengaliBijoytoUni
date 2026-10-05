import { describe, expect, it } from "vitest";
import { compareParagraphs, compareWords } from "../engine/diffEngine";
import { annotateSegments, splitByMarks } from "../spelling/annotate";
import { checkSpelling } from "../spelling/checkSpelling";
import type { SpellChecker } from "../spelling/types";

const KNOWN = new Set(
  "the cat sat on mat please receive payment case no dated and was on bank bill this is a line of text with".split(" "),
);
const fake: SpellChecker = { correct: (w) => KNOWN.has(w.toLowerCase()), suggest: () => [] };

function annotate(compare: typeof compareWords, source: string, target: string) {
  const result = compare(source, target);
  const marks = annotateSegments(
    result,
    { text: source, spelling: checkSpelling(source, fake) },
    { text: target, spelling: checkSpelling(target, fake) },
    fake,
  );
  return { result, marks };
}

/** [segment type, flagged words] for every segment that has any. */
const flaggedBySegment = (result: ReturnType<typeof compareWords>, marks: ReturnType<typeof annotateSegments>) =>
  result.segments
    .map((segment, i) => [segment.type, marks[i].map((m) => segment.value.slice(m.start, m.end))] as const)
    .filter(([, words]) => words.length > 0);

describe("annotateSegments — word mode", () => {
  it("puts a typo that was fixed on the removed segment, and one that was introduced on the added one", () => {
    const { result, marks } = annotate(compareWords, "please recieve the payment", "please receive the paymnt");
    expect(flaggedBySegment(result, marks)).toEqual([
      ["removed", ["recieve"]],
      ["added", ["paymnt"]],
    ]);
  });

  it("marks an unchanged typo once, in the unchanged segment", () => {
    const { result, marks } = annotate(compareWords, "the cat teh mat", "the cat teh mat on the bank");
    expect(flaggedBySegment(result, marks)).toEqual([["unchanged", ["teh"]]]);
  });

  it("keeps whole-text context: a reference split across a diff boundary is still not flagged", () => {
    const { result, marks } = annotate(compareWords, "case no 12/2020 dated", "case no 12/2021 dated");
    expect(flaggedBySegment(result, marks)).toEqual([]);
    expect(marks).toHaveLength(result.segments.length);
  });

  it("returns offsets relative to each segment's own value", () => {
    const { result, marks } = annotate(compareWords, "the cat", "the cat sat on the mmat");
    const added = result.segments.findIndex((s) => s.type === "added");
    const [mark] = marks[added];
    expect(result.segments[added].value.slice(mark.start, mark.end)).toBe("mmat");
  });

  it("returns an empty list per segment when both sides are legacy text", () => {
    const legacy = "wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv wkÿv †evW© n‡Z";
    const { marks, result } = annotate(compareWords, legacy, `${legacy} wkÿv`);
    expect(marks).toHaveLength(result.segments.length);
    expect(marks.every((m) => m.length === 0)).toBe(true);
  });

  it("skips only the legacy side", () => {
    const legacy = "wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv wkÿv †evW© n‡Z";
    const { result, marks } = annotate(compareWords, legacy, "please recieve");
    const flagged = flaggedBySegment(result, marks);
    expect(flagged).toEqual([["added", ["recieve"]]]);
  });
});

describe("annotateSegments — paragraph mode", () => {
  it("checks each paragraph on its own", () => {
    const { result, marks } = annotate(
      compareParagraphs,
      "the cat sat\n\nplease recieve the bank",
      "the cat sat\n\nplease receive the bnak",
    );
    expect(flaggedBySegment(result, marks)).toEqual([
      ["removed", ["recieve"]],
      ["added", ["bnak"]],
    ]);
  });
});

describe("splitByMarks", () => {
  it("returns the value whole when nothing is flagged", () => {
    expect(splitByMarks("the cat", [])).toEqual([{ text: "the cat" }]);
  });

  it("cuts around flagged words and rejoins to the original exactly", () => {
    const value = "a teh b recieve";
    const marks = [
      { word: "teh", start: 2, end: 5 },
      { word: "recieve", start: 8, end: 15 },
    ];
    const pieces = splitByMarks(value, marks);
    expect(pieces.map((p) => p.text).join("")).toBe(value);
    expect(pieces.filter((p) => p.mark).map((p) => p.text)).toEqual(["teh", "recieve"]);
  });

  it("ignores a mark that overlaps one already emitted", () => {
    const pieces = splitByMarks("abcdef", [
      { word: "abc", start: 0, end: 3 },
      { word: "bcd", start: 1, end: 4 },
    ]);
    expect(pieces.map((p) => p.text).join("")).toBe("abcdef");
    expect(pieces.filter((p) => p.mark)).toHaveLength(1);
  });
});
