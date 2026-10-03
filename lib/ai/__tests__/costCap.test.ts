/**
 * The daily call budget. Every clock and every limit is injected, so the
 * day boundary and the exhaustion case are asserted directly rather than
 * waited for. **No test here calls an external API**, and none touches
 * Firestore: the count lives in an injected `CounterStore`, and two budgets
 * sharing one in-memory store stand in for two Vercel instances sharing the
 * Firestore document.
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
import { createMemoryCounterStore, type CounterStore } from "@/lib/security/counterStore";

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
  it("takes the default when nothing is set", async () => {
    expect(configuredDailyCallBudget(undefined)).toBe(DEFAULT_DAILY_CALL_BUDGET);
    expect(configuredDailyCallBudget("")).toBe(DEFAULT_DAILY_CALL_BUDGET);
    expect(configuredDailyCallBudget("  ")).toBe(DEFAULT_DAILY_CALL_BUDGET);
  });

  it("derives that default from the route's own rate limit rather than picking one", async () => {
    expect(DEFAULT_DAILY_CALL_BUDGET).toBe(5 * RESOLUTION_LIMITS.resolveRateLimit.limit);
  });

  it("reads a number that is set", async () => {
    expect(configuredDailyCallBudget("7")).toBe(7);
    expect(configuredDailyCallBudget(" 7 ")).toBe(7);
    expect(configuredDailyCallBudget("0")).toBe(0);
    // Accepted: `Number` reads it as the integer 1000, and someone writing
    // it meant a bigger budget, not a smaller one. The rule being enforced
    // is "a mistake must not widen the limit", not "the input must be
    // decimal digits".
    expect(configuredDailyCallBudget("1e3")).toBe(1_000);
  });

  it("treats anything unparseable as zero, not as unlimited", async () => {
    // A typo in a spending limit must never read as a larger limit.
    for (const raw of ["unlimited", "-1", "12.5", "20 calls", "NaN", "Infinity"]) {
      expect(configuredDailyCallBudget(raw), raw).toBe(0);
    }
  });

  it("reads the environment at call time", async () => {
    vi.stubEnv(AI_DAILY_CALL_BUDGET_ENV, "3");
    expect(configuredDailyCallBudget()).toBe(3);
    vi.stubEnv(AI_DAILY_CALL_BUDGET_ENV, "4");
    expect(configuredDailyCallBudget()).toBe(4);
  });
});

describe("reserving against the budget", () => {
  it("allows calls up to the limit and then refuses", async () => {
    const { budget } = budgetOf(2);
    expect((await budget.reserve()).ok).toBe(true);
    expect((await budget.reserve()).ok).toBe(true);
    const third = await budget.reserve();
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.error.code).toBe("provider_budget_exhausted");
  });

  it("refuses everything at a budget of zero", async () => {
    expect((await budgetOf(0).budget.reserve()).ok).toBe(false);
  });

  it("names the limit and the day in the refusal, without naming a provider", async () => {
    const { budget } = budgetOf(0);
    const refused = await budget.reserve();
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    // Null provider on purpose: switching provider must not be a way around
    // a deployment-wide budget.
    expect(refused.error.provider).toBeNull();
    expect(refused.error.message).toContain("2026-09-22");
    expect(refused.error.message).toContain("0");
  });

  it("counts a reservation before the call, so two callers cannot take the last unit", async () => {
    // Both reservations are in flight at once. Incrementing on reserve,
    // atomically in the store, rather than on completion is what makes that
    // safe.
    const { budget } = budgetOf(1);
    const [first, second] = await Promise.all([budget.reserve(), budget.reserve()]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it("gives a unit back when the call did not happen", async () => {
    const { budget } = budgetOf(1);
    await budget.reserve();
    expect((await budget.reserve()).ok).toBe(false);
    await budget.release();
    expect((await budget.reserve()).ok).toBe(true);
  });

  it("never releases below zero", async () => {
    const { budget } = budgetOf(1);
    await budget.release();
    await budget.release();
    expect((await budget.usage()).used).toBe(0);
  });
});

describe("the day boundary", () => {
  it("resets at midnight UTC", async () => {
    const { budget, clock } = budgetOf(1);
    expect((await budget.reserve()).ok).toBe(true);
    expect((await budget.reserve()).ok).toBe(false);

    clock.value = new Date("2026-09-23T00:00:00.000Z");
    expect((await budget.reserve()).ok).toBe(true);
  });

  it("does not reset merely because hours passed", async () => {
    const { budget, clock } = budgetOf(1);
    await budget.reserve();
    clock.value = new Date("2026-09-22T23:59:59.000Z");
    expect((await budget.reserve()).ok).toBe(false);
  });

  it("keys the day in UTC, so the reset does not move with a region", async () => {
    expect(utcDayKey(new Date("2026-09-22T23:30:00.000Z"))).toBe("2026-09-22");
    expect(utcDayKey(new Date("2026-09-23T00:30:00.000Z"))).toBe("2026-09-23");
  });
});

describe("what usage reports", () => {
  it("reports the day, the count, the limit and what is left", async () => {
    const { budget } = budgetOf(5);
    await budget.reserve();
    await budget.reserve();
    expect((await budget.usage())).toStrictEqual({
      day: "2026-09-22",
      used: 2,
      limit: 5,
      remaining: 3,
      estimatedCost: null,
    });
  });

  it("reports no cost when no price is configured", async () => {
    // Nothing in this repository records a per-call price, so the honest
    // answer is null rather than a number somebody typed.
    expect((await budgetOf(5).budget.usage()).estimatedCost).toBeNull();
  });

  it("projects a cost only when an operator supplies the price", async () => {
    const budget = createDailyCallBudget({
      maxCallsPerDay: () => 10,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
      estimatedCostPerCall: 0.002,
    });
    await budget.reserve();
    await budget.reserve();
    expect((await budget.usage()).estimatedCost).toBeCloseTo(0.004);
  });

  it("never reports a negative remaining", async () => {
    const budget = createDailyCallBudget({
      maxCallsPerDay: () => 1,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
    });
    await budget.reserve();
    // The limit dropping under the count (an operator lowering it mid-day)
    // must read as "none left", not as a negative.
    const lowered = createDailyCallBudget({
      maxCallsPerDay: () => 0,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
    });
    await lowered.reserve();
    expect((await lowered.usage()).remaining).toBe(0);
    expect((await budget.usage()).remaining).toBe(0);
  });
});

describe("one budget across instances", () => {
  const at = () => new Date("2026-09-22T10:00:00.000Z");

  it("holds one ceiling for two instances sharing a store", async () => {
    // Two `createDailyCallBudget` calls are two serverless instances; the
    // store is the Firestore document they both see. Before the deployment
    // answer each instance had its own map, so this ceiling was 2 x 2.
    const store = createMemoryCounterStore();
    const instanceA = createDailyCallBudget({ maxCallsPerDay: () => 2, now: at, store });
    const instanceB = createDailyCallBudget({ maxCallsPerDay: () => 2, now: at, store });

    expect((await instanceA.reserve()).ok).toBe(true);
    expect((await instanceB.reserve()).ok).toBe(true);
    expect((await instanceA.reserve()).ok).toBe(false);
    expect((await instanceB.reserve()).ok).toBe(false);
    expect((await instanceB.usage()).used).toBe(2);
  });

  it("keys the counter by UTC day, so midnight is a new document", async () => {
    const reserved: string[] = [];
    const store = createMemoryCounterStore();
    const spy: CounterStore = {
      ...store,
      reserve: (slot) => {
        reserved.push(`${slot.collection}/${slot.docId}`);
        return store.reserve(slot);
      },
    };
    await createDailyCallBudget({ maxCallsPerDay: () => 5, now: at, store: spy }).reserve();
    expect(reserved).toStrictEqual(["aiCallBudget/2026-09-22"]);
  });

  it("refuses, as unavailable rather than exhausted, when the store cannot be reached", async () => {
    const broken: CounterStore = {
      reserve: async () => {
        throw new Error("firestore unavailable");
      },
      release: async () => undefined,
      read: async () => 0,
    };
    const result = await createDailyCallBudget({ maxCallsPerDay: () => 5, now: at, store: broken }).reserve();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Fails closed: an outage must not read as "unlimited", and must not be
    // reported as a spent day either.
    expect(result.error.code).toBe("provider_budget_unavailable");
    expect(result.error.provider).toBeNull();
  });

  it("refuses a zero budget without a store round trip", async () => {
    const reserve = vi.fn(async () => ({ admitted: true as const, count: 1 }));
    const store: CounterStore = { reserve, release: async () => undefined, read: async () => 0 };
    const result = await createDailyCallBudget({ maxCallsPerDay: () => 0, now: at, store }).reserve();
    expect(result.ok).toBe(false);
    expect(reserve).not.toHaveBeenCalled();
  });
});
