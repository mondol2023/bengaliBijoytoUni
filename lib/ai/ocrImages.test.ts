import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCounterStore } from "@/lib/security/counterStore";
import { createOcrCallBudget, type OcrCallBudget } from "@/lib/ocr/budget";
import { ProviderErrors } from "./errors";
import { readOcrImages, isOcrAiAvailable, shouldTryNextProvider } from "./ocrImages";
import {
  providerErr,
  providerOk,
  type OcrImageInput,
  type OcrImageProvider,
  type ProviderId,
  type ProviderResult,
} from "./types";
import type { ProviderError } from "./errors";

const images: OcrImageInput[] = [{ mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff]) }];

function fakeProvider(
  id: ProviderId,
  behaviour: ProviderError | string[] | "unconfigured",
): OcrImageProvider & { calls: number } {
  const provider = {
    id,
    model: `${id}-model`,
    calls: 0,
    isConfigured: () => behaviour !== "unconfigured",
    async readImages(): Promise<ProviderResult<{ texts: readonly string[]; provider: ProviderId; model: string; promptVersion: string }>> {
      provider.calls += 1;
      if (Array.isArray(behaviour)) {
        return providerOk({ texts: behaviour, provider: id, model: `${id}-model`, promptVersion: "ocr-v2" });
      }
      if (behaviour === "unconfigured") return providerErr(ProviderErrors.notConfigured(id));
      return providerErr(behaviour);
    },
  };
  return provider;
}

function budgets(limitFor: Partial<Record<ProviderId, number>> = {}) {
  const store = createMemoryCounterStore();
  const made: Partial<Record<ProviderId, OcrCallBudget>> = {};
  const reserveSpy = vi.fn();
  return {
    reserveSpy,
    budgetFor(id: ProviderId): OcrCallBudget {
      made[id] ??= (() => {
        const real = createOcrCallBudget({ provider: id, store, maxCallsPerDay: () => limitFor[id] ?? 100 });
        return {
          ...real,
          reserve: () => {
            reserveSpy(id);
            return real.reserve();
          },
        };
      })();
      return made[id]!;
    },
  };
}

const chain = (...providers: OcrImageProvider[]) => () => providerOk(providers);

describe("shouldTryNextProvider", () => {
  it.each([
    ["provider_rate_limited", true],
    ["provider_unavailable", true],
    ["provider_timeout", true],
    ["provider_budget_exhausted", true],
    ["provider_authentication_failed", false],
    ["provider_invalid_response", false],
    ["provider_content_rejected", false],
    ["provider_unknown_error", false],
    ["provider_budget_unavailable", false],
  ] as const)("%s -> %s", (code, expected) => {
    expect(shouldTryNextProvider({ code, provider: "gemini", message: "x" })).toBe(expected);
  });
});

describe("readOcrImages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the disabled error and reserves nothing when the switch is off", async () => {
    const b = budgets();
    const result = await readOcrImages(images, {
      providers: () => providerErr(ProviderErrors.disabled("AI text reading")),
      budgetFor: b.budgetFor,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND_ERROR");
    expect(b.reserveSpy).not.toHaveBeenCalled();
  });

  it("returns the first provider's texts after one reservation", async () => {
    const a = fakeProvider("gemini", ["ক"]);
    const b = budgets();
    const result = await readOcrImages(images, { providers: chain(a), budgetFor: b.budgetFor });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ texts: ["ক"], provider: "gemini" });
    expect(b.reserveSpy).toHaveBeenCalledTimes(1);
  });

  it("moves to the next provider on a rate limit and reports who answered", async () => {
    const a = fakeProvider("gemini", ProviderErrors.rateLimited("gemini"));
    const second = fakeProvider("openai", ["খ"]);
    const b = budgets();
    const result = await readOcrImages(images, { providers: chain(a, second), budgetFor: b.budgetFor });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.provider).toBe("openai");
    expect(a.calls).toBe(1);
    expect(second.calls).toBe(1);
    expect(b.reserveSpy.mock.calls.map((c) => c[0])).toEqual(["gemini", "openai"]);
  });

  it("stops at an authentication failure and never calls the next provider", async () => {
    const a = fakeProvider("gemini", ProviderErrors.authenticationFailed("gemini"));
    const second = fakeProvider("openai", ["খ"]);
    const result = await readOcrImages(images, { providers: chain(a, second), budgetFor: budgets().budgetFor });
    expect(result.ok).toBe(false);
    expect(second.calls).toBe(0);
  });

  it("skips a provider whose budget is spent, without calling it", async () => {
    const a = fakeProvider("gemini", ["ক"]);
    const second = fakeProvider("openai", ["খ"]);
    const b = budgets({ gemini: 0 });
    const result = await readOcrImages(images, { providers: chain(a, second), budgetFor: b.budgetFor });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.provider).toBe("openai");
    expect(a.calls).toBe(0);
  });

  it("returns the first error when every provider fails, without leaking a later debug", async () => {
    const a = fakeProvider("gemini", ProviderErrors.unavailable("gemini", "FIRST-DEBUG"));
    const second = fakeProvider("openai", ProviderErrors.timeout("openai", "SECOND-DEBUG"));
    const result = await readOcrImages(images, { providers: chain(a, second), budgetFor: budgets().budgetFor });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("gemini");
      expect(JSON.stringify(result.error)).not.toContain("SECOND-DEBUG");
    }
  });

  it("skips an unconfigured provider without reserving, and reports 'not set up' when none are left", async () => {
    const a = fakeProvider("gemini", "unconfigured");
    const b = budgets();
    const result = await readOcrImages(images, { providers: chain(a), budgetFor: b.budgetFor });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("not set up");
    expect(b.reserveSpy).not.toHaveBeenCalled();
    expect(a.calls).toBe(0);
  });

  it("falls through an unconfigured provider to a configured one", async () => {
    const a = fakeProvider("gemini", "unconfigured");
    const second = fakeProvider("openai", ["খ"]);
    const result = await readOcrImages(images, { providers: chain(a, second), budgetFor: budgets().budgetFor });
    expect(result.ok).toBe(true);
  });

  it.each([[0], [5]])("rejects %i images before reserving anything", async (count) => {
    const a = fakeProvider("gemini", ["ক"]);
    const b = budgets();
    const many = Array.from({ length: count }, () => images[0]);
    const result = await readOcrImages(many, { providers: chain(a), budgetFor: b.budgetFor });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(b.reserveSpy).not.toHaveBeenCalled();
  });
});

describe("isOcrAiAvailable", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is false when no provider is enabled", async () => {
    expect(await isOcrAiAvailable({ providers: () => providerErr(ProviderErrors.disabled()) })).toBe(false);
  });

  it("is false when enabled but nothing is configured, true when something is", async () => {
    expect(await isOcrAiAvailable({ providers: chain(fakeProvider("gemini", "unconfigured")) })).toBe(false);
    expect(await isOcrAiAvailable({ providers: chain(fakeProvider("gemini", ["ক"])) })).toBe(true);
  });
});
