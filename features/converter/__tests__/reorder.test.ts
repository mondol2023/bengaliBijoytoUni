import { describe, expect, it } from "vitest";
import { reorderTokens } from "../engine/reorder";
import type { Token } from "../encodings/types";

let nextSourceIndex = 0;
function token(legacy: string, unicode: string, reorder: Token["reorder"] = "none"): Token {
  return { legacy, unicode, reorder, sourceIndex: nextSourceIndex++ };
}

describe("reorderTokens", () => {
  it("moves a before-consonant token after the following token", () => {
    const result = reorderTokens([token("w", "ি", "before-consonant"), token("K", "ক")]);
    expect(result.map((t) => t.unicode).join("")).toBe("কি");
  });

  it("moves a reph token before the preceding token", () => {
    const result = reorderTokens([token("K", "ক"), token("©", "র্", "reph")]);
    expect(result.map((t) => t.unicode).join("")).toBe("র্ক");
  });

  it("puts a reph before the consonant cluster, not before its vowel sign", () => {
    const result = reorderTokens([
      token("j", "ম"),
      token("−", "ে", "before-consonant"),
      token("j", "ম"),
      token("Ñ", "র্", "reph"),
    ]);
    expect(result.map((t) => t.unicode).join("")).toBe("মর্মে");
  });

  it("puts a reph before a hasant-spelled conjunct, not inside it", () => {
    const result = reorderTokens([
      token("K", "ক"),
      token("&", "্"),
      token("Z", "ত"),
      token("©", "র্", "reph"),
    ]);
    expect(result.map((t) => t.unicode).join("")).toBe("র্ক্ত");
  });

  it("leaves after-consonant and none tokens in place", () => {
    const result = reorderTokens([token("K", "ক"), token("v", "া", "after-consonant")]);
    expect(result.map((t) => t.unicode).join("")).toBe("কা");
  });

  it("appends a trailing before-consonant token instead of dropping it", () => {
    const result = reorderTokens([token("K", "ক"), token("w", "ি", "before-consonant")]);
    expect(result.map((t) => t.unicode).join("")).toBe("কি");
  });

  it("handles empty input", () => {
    expect(reorderTokens([])).toEqual([]);
  });
});
