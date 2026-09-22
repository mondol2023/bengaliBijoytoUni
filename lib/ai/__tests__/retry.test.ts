/**
 * Retry policy. Every test injects `sleep` and `random`, so the suite runs
 * in milliseconds and the backoff arithmetic is asserted rather than waited
 * out. **No test here calls an external API** — the "provider" is a function
 * returning canned `ProviderResult`s.
 */
import { describe, expect, it, vi } from "vitest";
import { ProviderErrors, type ProviderError, type ProviderErrorCode } from "../errors";
import { providerErr, providerOk, type ProviderResult } from "../types";
import {
  DEFAULT_RETRY_POLICY,
  backoffDelayMs,
  isRetryableProviderError,
  withProviderRetry,
} from "../retry";

const noSleep = async () => {};

function sequence(...results: ProviderResult<string>[]) {
  let index = 0;
  return vi.fn(async () => results[Math.min(index++, results.length - 1)]);
}

describe("which failures may be retried", () => {
  it("retries the three that are about the moment", () => {
    expect(isRetryableProviderError(ProviderErrors.timeout("gemini"))).toBe(true);
    expect(isRetryableProviderError(ProviderErrors.unavailable("gemini"))).toBe(true);
    expect(isRetryableProviderError(ProviderErrors.rateLimited("gemini"))).toBe(true);
  });

  it("does not retry the ones that are about the request", () => {
    // Each of these would return the same answer and bill for it again.
    expect(isRetryableProviderError(ProviderErrors.authenticationFailed("gemini"))).toBe(false);
    expect(isRetryableProviderError(ProviderErrors.invalidResponse("gemini"))).toBe(false);
    expect(isRetryableProviderError(ProviderErrors.contentRejected("gemini"))).toBe(false);
    expect(isRetryableProviderError(ProviderErrors.notConfigured("gemini"))).toBe(false);
    expect(isRetryableProviderError(ProviderErrors.disabled())).toBe(false);
    expect(isRetryableProviderError(ProviderErrors.unknown("gemini"))).toBe(false);
  });

  it("does not retry an exhausted budget", () => {
    expect(isRetryableProviderError(ProviderErrors.budgetExhausted(100, "2026-09-22"))).toBe(false);
  });

  it("refuses to retry a code it has never seen", () => {
    const invented = { code: "provider_invented" as ProviderErrorCode, provider: null, message: "" };
    expect(isRetryableProviderError(invented as ProviderError)).toBe(false);
  });
});

describe("withProviderRetry", () => {
  it("returns a success without retrying", async () => {
    const call = sequence(providerOk("fine"));
    const result = await withProviderRetry(call, { sleep: noSleep });
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retries a timeout and returns the success that follows", async () => {
    const call = sequence(providerErr(ProviderErrors.timeout("gemini")), providerOk("second time"));
    const result = await withProviderRetry(call, { sleep: noSleep, random: () => 0 });
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.ok && result.value).toBe("second time");
  });

  it("gives up after the configured number of attempts", async () => {
    const call = sequence(providerErr(ProviderErrors.unavailable("gemini")));
    const result = await withProviderRetry(call, { attempts: 3, sleep: noSleep, random: () => 0 });
    expect(call).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
  });

  it("stops immediately on a failure that is about the request", async () => {
    const call = sequence(providerErr(ProviderErrors.authenticationFailed("gemini")));
    await withProviderRetry(call, { sleep: noSleep });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("returns the last error, not a synthesized one", async () => {
    const call = sequence(providerErr(ProviderErrors.timeout("gemini")));
    const result = await withProviderRetry(call, { attempts: 2, sleep: noSleep, random: () => 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider_timeout");
  });

  it("makes exactly one call when retrying is disabled", async () => {
    const call = sequence(providerErr(ProviderErrors.timeout("gemini")));
    await withProviderRetry(call, { attempts: 1, sleep: noSleep });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("reports each wait before taking it", async () => {
    const onRetry = vi.fn();
    const call = sequence(providerErr(ProviderErrors.timeout("gemini")));
    await withProviderRetry(call, { attempts: 3, sleep: noSleep, random: () => 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0].attempt).toBe(1);
    expect(onRetry.mock.calls[1][0].attempt).toBe(2);
  });

  it("actually waits between attempts", async () => {
    const slept: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      slept.push(ms);
    });
    const call = sequence(providerErr(ProviderErrors.unavailable("gemini")), providerOk("ok"));
    await withProviderRetry(call, { sleep, random: () => 1, baseDelayMs: 100, maxDelayMs: 1_000 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(slept).toStrictEqual([100]);
  });
});

describe("backoff arithmetic", () => {
  const policy = { attempts: 4, baseDelayMs: 500, maxDelayMs: 4_000 };
  const timeout = ProviderErrors.timeout("gemini");

  it("doubles the ceiling with each attempt", () => {
    expect(backoffDelayMs(1, policy, () => 1, timeout)).toBe(500);
    expect(backoffDelayMs(2, policy, () => 1, timeout)).toBe(1_000);
    expect(backoffDelayMs(3, policy, () => 1, timeout)).toBe(2_000);
  });

  it("does not exceed the cap", () => {
    expect(backoffDelayMs(10, policy, () => 1, timeout)).toBe(policy.maxDelayMs);
  });

  it("is full jitter, not a fixed schedule", () => {
    // The correlated-retry problem: a fixed delay lines every caller up on
    // the same instant.
    expect(backoffDelayMs(3, policy, () => 0, timeout)).toBe(0);
    expect(backoffDelayMs(3, policy, () => 0.5, timeout)).toBe(1_000);
    expect(backoffDelayMs(3, policy, () => 1, timeout)).toBe(2_000);
  });

  it("obeys a provider's own Retry-After instead of guessing", () => {
    const limited = ProviderErrors.rateLimited("gemini", 2);
    expect(backoffDelayMs(1, policy, () => 0, limited)).toBe(2_000);
  });

  it("still caps a provider's Retry-After, so one header cannot hang a request", () => {
    const limited = ProviderErrors.rateLimited("gemini", 3_600);
    expect(backoffDelayMs(1, policy, () => 0, limited)).toBe(policy.maxDelayMs);
  });

  it("keeps the default schedule inside a request an admin is waiting on", () => {
    const worst = [1, 2].reduce(
      (total, attempt) => total + backoffDelayMs(attempt, DEFAULT_RETRY_POLICY, () => 1, timeout),
      0,
    );
    expect(worst).toBeLessThanOrEqual(2_000);
  });
});
