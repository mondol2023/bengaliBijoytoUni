import { describe, expect, it } from "vitest";
import { checkUsage, validateUsage } from "../usageService";
import { TIERS } from "../tierConfig";

describe("checkUsage", () => {
  it("is within limit exactly at the tier boundary", () => {
    const text = "a".repeat(TIERS.easy.maxNonWhitespaceChars);
    const usage = checkUsage(text, "easy");
    expect(usage.used).toBe(TIERS.easy.maxNonWhitespaceChars);
    expect(usage.withinLimit).toBe(true);
    expect(usage.remaining).toBe(0);
  });

  it("is over limit exactly one character past the boundary", () => {
    const text = "a".repeat(TIERS.easy.maxNonWhitespaceChars + 1);
    const usage = checkUsage(text, "easy");
    expect(usage.withinLimit).toBe(false);
  });

  it("only counts non-whitespace characters", () => {
    const usage = checkUsage("a b c", "easy");
    expect(usage.used).toBe(3);
  });

  it("an admin override raises the effective limit", () => {
    const text = "a".repeat(TIERS.easy.maxNonWhitespaceChars + 100);
    const usage = checkUsage(text, "easy", TIERS.easy.maxNonWhitespaceChars + 1000);
    expect(usage.withinLimit).toBe(true);
    expect(usage.max).toBe(TIERS.easy.maxNonWhitespaceChars + 1000);
  });
});

describe("validateUsage", () => {
  it("returns ok:true within limit", () => {
    const result = validateUsage("short text", "easy");
    expect(result.ok).toBe(true);
  });

  it("returns a typed LimitExceededError over the limit", () => {
    const text = "a".repeat(TIERS.easy.maxNonWhitespaceChars + 1);
    const result = validateUsage(text, "easy");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LIMIT_EXCEEDED_ERROR");
      expect(result.error.details?.tier).toBe("easy");
    }
  });

  it("each tier enforces its own configured limit", () => {
    for (const tier of Object.values(TIERS)) {
      const overText = "a".repeat(tier.maxNonWhitespaceChars + 1);
      const result = validateUsage(overText, tier.id);
      expect(result.ok).toBe(false);
    }
  });
});
