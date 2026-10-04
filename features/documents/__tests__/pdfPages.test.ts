import { describe, expect, it } from "vitest";
import { formatPageList } from "../extract/pdf";

describe("formatPageList", () => {
  it("collapses consecutive pages into ranges", () => {
    expect(formatPageList([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe("1–9");
    expect(formatPageList([2, 3, 4, 7])).toBe("2–4, 7");
    expect(formatPageList([5])).toBe("5");
  });
});
