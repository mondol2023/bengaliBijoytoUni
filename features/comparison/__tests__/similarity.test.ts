import { describe, expect, it } from "vitest";
import { overallSimilarity, wordOverlapSimilarity } from "../engine/similarity";

describe("wordOverlapSimilarity", () => {
  it("is 1 for identical text", () => {
    expect(wordOverlapSimilarity("hello world", "hello world")).toBe(1);
  });

  it("is 1 for two empty strings", () => {
    expect(wordOverlapSimilarity("", "")).toBe(1);
  });

  it("is 0 when one side is empty and the other isn't", () => {
    expect(wordOverlapSimilarity("hello", "")).toBe(0);
  });

  it("is 0 for completely disjoint word sets", () => {
    expect(wordOverlapSimilarity("alpha beta", "gamma delta")).toBe(0);
  });

  it("is order-insensitive", () => {
    expect(wordOverlapSimilarity("one two three", "three two one")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(wordOverlapSimilarity("Hello World", "hello world")).toBe(1);
  });

  it("scores partial overlap between 0 and 1", () => {
    const score = wordOverlapSimilarity("one two three four", "one two five six");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("overallSimilarity", () => {
  it("is 1 when both sides are empty", () => {
    expect(overallSimilarity(0, 0, 0)).toBe(1);
  });

  it("is 1 when everything is unchanged", () => {
    expect(overallSimilarity(10, 10, 10)).toBe(1);
  });

  it("is 0 when nothing is unchanged", () => {
    expect(overallSimilarity(10, 10, 0)).toBe(0);
  });

  it("never exceeds 1 even with mismatched counts", () => {
    expect(overallSimilarity(5, 5, 100)).toBeLessThanOrEqual(1);
  });
});
