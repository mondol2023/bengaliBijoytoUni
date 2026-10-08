import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCounterStore, type CounterStore } from "@/lib/security/counterStore";
import { createOcrCallBudget, OCR_CALL_BUDGET_COLLECTION, ocrBudgetEnvName } from "../budget";

const DAY_1 = new Date("2026-10-08T10:00:00Z");
const DAY_2 = new Date("2026-10-09T00:00:01Z");

function throwingStore(): CounterStore {
  const boom = () => {
    throw new Error("store unreachable");
  };
  return { reserve: boom, release: boom, read: boom };
}

describe("ocrBudgetEnvName", () => {
  it("is per provider", () => {
    expect(ocrBudgetEnvName("gemini")).toBe("OCR_GEMINI_DAILY_CALL_BUDGET");
    expect(ocrBudgetEnvName("openai")).toBe("OCR_OPENAI_DAILY_CALL_BUDGET");
  });
});

describe("createOcrCallBudget", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("admits up to the limit, refuses the next, and resets on a new UTC day", async () => {
    let now = DAY_1;
    const budget = createOcrCallBudget({
      provider: "gemini",
      store: createMemoryCounterStore(),
      maxCallsPerDay: () => 2,
      now: () => now,
    });
    expect((await budget.reserve()).ok).toBe(true);
    expect((await budget.reserve()).ok).toBe(true);
    const third = await budget.reserve();
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("provider_budget_exhausted");

    now = DAY_2;
    expect((await budget.reserve()).ok).toBe(true);
  });

  it("reports usage", async () => {
    const budget = createOcrCallBudget({
      provider: "gemini",
      store: createMemoryCounterStore(),
      maxCallsPerDay: () => 5,
      now: () => DAY_1,
    });
    await budget.reserve();
    const usage = await budget.usage();
    expect(usage).toMatchObject({ day: "2026-10-08", used: 1, limit: 5, remaining: 4 });
  });

  it.each([0, -3])("refuses a limit of %i without touching the store", async (limit) => {
    const budget = createOcrCallBudget({ provider: "gemini", store: throwingStore(), maxCallsPerDay: () => limit });
    const result = await budget.reserve();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_budget_exhausted");
  });

  it("reads the limit from the provider env var, and treats junk as zero", async () => {
    vi.stubEnv("OCR_GEMINI_DAILY_CALL_BUDGET", "abc");
    const budget = createOcrCallBudget({ provider: "gemini", store: createMemoryCounterStore(), now: () => DAY_1 });
    expect((await budget.reserve()).ok).toBe(false);

    vi.stubEnv("OCR_GEMINI_DAILY_CALL_BUDGET", "1");
    expect((await budget.reserve()).ok).toBe(true);
    expect((await budget.reserve()).ok).toBe(false);
  });

  it("is not armed by the resolution or transcription budget variable", async () => {
    vi.stubEnv("AI_DAILY_CALL_BUDGET", "0");
    vi.stubEnv("OCR_GEMINI_DAILY_CALL_BUDGET", undefined);
    const budget = createOcrCallBudget({ provider: "gemini", store: createMemoryCounterStore(), now: () => DAY_1 });
    expect((await budget.reserve()).ok).toBe(true);
  });

  it("fails closed when the store throws", async () => {
    const budget = createOcrCallBudget({ provider: "gemini", store: throwingStore(), maxCallsPerDay: () => 10 });
    const result = await budget.reserve();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_budget_unavailable");
  });

  it("keeps providers apart but shares a count between instances of one provider", async () => {
    const store = createMemoryCounterStore();
    const options = { store, maxCallsPerDay: () => 1, now: () => DAY_1 };
    const geminiA = createOcrCallBudget({ provider: "gemini", ...options });
    const geminiB = createOcrCallBudget({ provider: "gemini", ...options });
    const openai = createOcrCallBudget({ provider: "openai", ...options });

    expect((await geminiA.reserve()).ok).toBe(true);
    expect((await geminiB.reserve()).ok).toBe(false);
    expect((await openai.reserve()).ok).toBe(true);
  });

  it("uses its own collection, not the resolution budget", async () => {
    const store = createMemoryCounterStore();
    const budget = createOcrCallBudget({ provider: "gemini", store, maxCallsPerDay: () => 3, now: () => DAY_1 });
    await budget.reserve();
    expect(await store.read({ collection: OCR_CALL_BUDGET_COLLECTION, docId: "gemini-2026-10-08" })).toBe(1);
    expect(await store.read({ collection: "aiCallBudget", docId: "2026-10-08" })).toBe(0);
  });

  it("gives a unit back on release", async () => {
    const budget = createOcrCallBudget({
      provider: "gemini",
      store: createMemoryCounterStore(),
      maxCallsPerDay: () => 1,
      now: () => DAY_1,
    });
    await budget.reserve();
    await budget.release();
    expect((await budget.reserve()).ok).toBe(true);
  });
});
