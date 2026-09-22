/**
 * The daily call budget. Every clock and every limit is injected, so the
 * day boundary and the exhaustion case are asserted directly rather than
 * waited for. **No test here calls an external API.**
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_DAILY_CALL_BUDGET_ENV,
  DEFAULT_DAILY_CALL_BUDGET,
  configuredDailyCallBudget,
  createDailyCallBudget,
  utcDayKey,
} from "../costCap";
import { RESOLUTION_LIMITS } from "../limits";

afterEach(() => {
  vi.unstubAllEnvs();
});

function budgetOf(limit: number, clock = { value: new Date("2026-09-22T10:00:00.000Z") }) {
  return {
    clock,
    budget: createDailyCallBudget({ maxCallsPerDay: () => limit, now: () => clock.value }),
  };
}

describe("reading the configured budget", () => {
  it("takes the default when nothing is set", () => {
    expect(configuredDailyCallBudget(undefined)).toBe(DEFAULT_DAILY_CALL_BUDGET);
    expect(configuredDailyCallBudget("")).toBe(DEFAULT_DAILY_CALL_BUDGET);
    expect(configuredDailyCallBudget("  ")).toBe(DEFAULT_DAILY_CALL_BUDGET);
  });

  it("derives that default from the route's own rate limit rather than picking one", () => {
    expect(DEFAULT_DAILY_CALL_BUDGET).toBe(5 * RESOLUTION_LIMITS.resolveRateLimit.limit);
  });

  it("reads a number that is set", () => {
    expect(configuredDailyCallBudget("7")).toBe(7);
    expect(configuredDailyCallBudget(" 7 ")).toBe(7);
    expect(configuredDailyCallBudget("0")).toBe(0);
    // Accepted: `Number` reads it as the integer 1000, and someone writing
    // it meant a bigger budget, not a smaller one. The rule being enforced
    // is "a mistake must not widen the limit", not "the input must be
    // decimal digits".
    expect(configuredDailyCallBudget("1e3")).toBe(1_000);
  });

  it("treats anything unparseable as zero, not as unlimited", () => {
    // A typo in a spending limit must never read as a larger limit.
    for (const raw of ["unlimited", "-1", "12.5", "20 calls", "NaN", "Infinity"]) {
      expect(configuredDailyCallBudget(raw), raw).toBe(0);
    }
  });

  it("reads the environment at call time", () => {
    vi.stubEnv(AI_DAILY_CALL_BUDGET_ENV, "3");
    expect(configuredDailyCallBudget()).toBe(3);
    vi.stubEnv(AI_DAILY_CALL_BUDGET_ENV, "4");
    expect(configuredDailyCallBudget()).toBe(4);
  });
});

describe("reserving against the budget", () => {
  it("allows calls up to the limit and then refuses", () => {
    const { budget } = budgetOf(2);
    expect(budget.reserve().ok).toBe(true);
    expect(budget.reserve().ok).toBe(true);
    const third = budget.reserve();
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.error.code).toBe("provider_budget_exhausted");
  });

  it("refuses everything at a budget of zero", () => {
    expect(budgetOf(0).budget.reserve().ok).toBe(false);
  });

  it("names the limit and the day in the refusal, without naming a provider", () => {
    const { budget } = budgetOf(0);
    const refused = budget.reserve();
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    // Null provider on purpose: switching provider must not be a way around
    // a deployment-wide budget.
    expect(refused.error.provider).toBeNull();
    expect(refused.error.message).toContain("2026-09-22");
    expect(refused.error.message).toContain("0");
  });

  it("counts a reservation before the call, so two callers cannot take the last unit", () => {
    // Single-threaded, so "concurrent" means both reserve before either
    // awaits. Incrementing on reserve rather than on completion is what
    // makes that safe.
    const { budget } = budgetOf(1);
    const first = budget.reserve();
    const second = budget.reserve();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it("gives a unit back when the call did not happen", () => {
    const { budget } = budgetOf(1);
    budget.reserve();
    expect(budget.reserve().ok).toBe(false);
    budget.release();
    expect(budget.reserve().ok).toBe(true);
  });

  it("never releases below zero", () => {
    const { budget } = budgetOf(1);
    budget.release();
    budget.release();
    expect(budget.usage().used).toBe(0);
  });
});

describe("the day boundary", () => {
  it("resets at midnight UTC", () => {
    const { budget, clock } = budgetOf(1);
    expect(budget.reserve().ok).toBe(true);
    expect(budget.reserve().ok).toBe(false);

    clock.value = new Date("2026-09-23T00:00:00.000Z");
    expect(budget.reserve().ok).toBe(true);
  });

  it("does not reset merely because hours passed", () => {
    const { budget, clock } = budgetOf(1);
    budget.reserve();
    clock.value = new Date("2026-09-22T23:59:59.000Z");
    expect(budget.reserve().ok).toBe(false);
  });

  it("keys the day in UTC, so the reset does not move with a region", () => {
    expect(utcDayKey(new Date("2026-09-22T23:30:00.000Z"))).toBe("2026-09-22");
    expect(utcDayKey(new Date("2026-09-23T00:30:00.000Z"))).toBe("2026-09-23");
  });
});

describe("what usage reports", () => {
  it("reports the day, the count, the limit and what is left", () => {
    const { budget } = budgetOf(5);
    budget.reserve();
    budget.reserve();
    expect(budget.usage()).toStrictEqual({
      day: "2026-09-22",
      used: 2,
      limit: 5,
      remaining: 3,
      estimatedCost: null,
    });
  });

  it("reports no cost when no price is configured", () => {
    // Nothing in this repository records a per-call price, so the honest
    // answer is null rather than a number somebody typed.
    expect(budgetOf(5).budget.usage().estimatedCost).toBeNull();
  });

  it("projects a cost only when an operator supplies the price", () => {
    const budget = createDailyCallBudget({
      maxCallsPerDay: () => 10,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
      estimatedCostPerCall: 0.002,
    });
    budget.reserve();
    budget.reserve();
    expect(budget.usage().estimatedCost).toBeCloseTo(0.004);
  });

  it("never reports a negative remaining", () => {
    const budget = createDailyCallBudget({
      maxCallsPerDay: () => 1,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
    });
    budget.reserve();
    // The limit dropping under the count (an operator lowering it mid-day)
    // must read as "none left", not as a negative.
    const lowered = createDailyCallBudget({
      maxCallsPerDay: () => 0,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
    });
    lowered.reserve();
    expect(lowered.usage().remaining).toBe(0);
    expect(budget.usage().remaining).toBe(0);
  });
});
