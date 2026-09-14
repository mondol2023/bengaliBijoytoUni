import { describe, expect, it } from "vitest";
import { compareWords, compareParagraphs, compareText } from "../engine/diffEngine";
import type { DiffResult } from "../engine/types";

/** Reconstructs the "target" side of a diff from its segments, for round-trip sanity checks. */
function reconstructTarget(result: DiffResult): string {
  return result.segments
    .filter((s) => s.type !== "removed")
    .map((s) => s.value)
    .join("");
}

/** Reconstructs the "source" side of a diff from its segments. */
function reconstructSource(result: DiffResult): string {
  return result.segments
    .filter((s) => s.type !== "added")
    .map((s) => s.value)
    .join("");
}

describe("compareWords", () => {
  it("identical documents have similarity 1 and no changes", () => {
    const text = "This is a sample sentence for comparison.";
    const result = compareWords(text, text);
    expect(result.similarity).toBe(1);
    expect(result.additions).toHaveLength(0);
    expect(result.removals).toHaveLength(0);
    expect(result.modifications).toHaveLength(0);
  });

  it("two empty strings are identical", () => {
    const result = compareWords("", "");
    expect(result.similarity).toBe(1);
    expect(result.segments).toHaveLength(0);
  });

  it("completely different documents have low similarity", () => {
    const result = compareWords(
      "The quick brown fox jumps over the lazy dog.",
      "Quantum entanglement defies classical intuition entirely.",
    );
    expect(result.similarity).toBeLessThan(0.3);
  });

  it("detects a pure insertion", () => {
    const result = compareWords("Hello world.", "Hello beautiful world.");
    expect(result.additions.length).toBeGreaterThan(0);
    expect(result.removals).toHaveLength(0);
    expect(reconstructTarget(result)).toBe("Hello beautiful world.");
    expect(reconstructSource(result)).toBe("Hello world.");
  });

  it("detects a pure deletion", () => {
    const result = compareWords("Hello beautiful world.", "Hello world.");
    expect(result.removals.length).toBeGreaterThan(0);
    expect(result.additions).toHaveLength(0);
    expect(reconstructTarget(result)).toBe("Hello world.");
    expect(reconstructSource(result)).toBe("Hello beautiful world.");
  });

  it("pairs a reworded phrase into a modification, not unrelated add/remove", () => {
    const result = compareWords(
      "The report was submitted on Monday morning.",
      "The report was submitted on Tuesday morning.",
    );
    expect(result.modifications.length).toBeGreaterThanOrEqual(1);
    expect(result.modifications[0].removed.value).toContain("Monday");
    expect(result.modifications[0].added.value).toContain("Tuesday");
  });

  it("similarity decreases monotonically as more words change", () => {
    const base = "one two three four five six seven eight nine ten";
    const oneWordChanged = compareWords(base, "one two three four five six seven eight nine TEN");
    const halfChanged = compareWords(base, "ONE TWO THREE FOUR FIVE six seven eight nine ten");
    expect(halfChanged.similarity).toBeLessThan(oneWordChanged.similarity);
  });

  it("handles mixed Bengali/English content and reconstructs both sides", () => {
    const source = "Please convert this file: আমার সোনার বাংলা, thanks.";
    const target = "Please convert this document: আমার সোনার বাংলা, thanks a lot.";
    const result = compareWords(source, target);
    expect(reconstructSource(result)).toBe(source);
    expect(reconstructTarget(result)).toBe(target);
    expect(result.similarity).toBeGreaterThan(0.4);
    expect(result.similarity).toBeLessThan(1);
  });

  it("segments a run of Bengali text as whole words, not one token per character", () => {
    // Without Intl.Segmenter-based tokenization, jsdiff's default word
    // tokenizer would split প্রতিটি Bengali character into its own token.
    const result = compareWords("আমার নাম রহিম।", "তোমার নাম রহিম।");
    const changedSegments = result.segments.filter((s) => s.type !== "unchanged");
    // "আমার" -> "তোমার" should show up as a single-word modification/pair,
    // not a cluster of single-character add/remove segments.
    expect(changedSegments.length).toBeLessThanOrEqual(2);
  });

  it("counts words using the shared word-count definition", () => {
    const result = compareWords("one two three", "one two three four");
    expect(result.statistics.sourceWords).toBe(3);
    expect(result.statistics.targetWords).toBe(4);
    expect(result.statistics.changedWords).toBeGreaterThan(0);
  });
});

describe("compareParagraphs", () => {
  it("identical multi-paragraph documents have similarity 1", () => {
    const text = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.";
    const result = compareParagraphs(text, text);
    expect(result.similarity).toBe(1);
    expect(result.mode).toBe("paragraph");
  });

  it("treats a single changed word as an entire changed paragraph", () => {
    const source = "Alpha paragraph unchanged.\n\nBeta paragraph original wording.";
    const target = "Alpha paragraph unchanged.\n\nBeta paragraph revised wording.";
    const result = compareParagraphs(source, target);
    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0].value).toContain("Alpha");
    const touchedParagraph = [...result.modifications.map((m) => m.removed.value), ...result.removals.map((r) => r.value)].join(" ");
    expect(touchedParagraph).toContain("Beta paragraph original wording.");
  });

  it("detects an inserted paragraph", () => {
    const source = "First paragraph.\n\nThird paragraph.";
    const target = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const result = compareParagraphs(source, target);
    expect(result.additions.some((a) => a.value.includes("Second paragraph."))).toBe(true);
  });

  it("detects a removed paragraph", () => {
    const source = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const target = "First paragraph.\n\nThird paragraph.";
    const result = compareParagraphs(source, target);
    expect(result.removals.some((r) => r.value.includes("Second paragraph."))).toBe(true);
  });

  it("completely different documents have low similarity", () => {
    const result = compareParagraphs(
      "Paragraph about cooking recipes and ingredients.",
      "Paragraph about astrophysics and black holes.",
    );
    expect(result.similarity).toBeLessThan(0.3);
  });
});

describe("compareText dispatcher", () => {
  it("routes to word mode", () => {
    const result = compareText("word", "hello world", "hello there world");
    expect(result.mode).toBe("word");
  });

  it("routes to paragraph mode", () => {
    const result = compareText("paragraph", "a\n\nb", "a\n\nc");
    expect(result.mode).toBe("paragraph");
  });
});
