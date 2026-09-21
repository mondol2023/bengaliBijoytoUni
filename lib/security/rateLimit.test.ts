import { describe, expect, it, vi } from "vitest";
import { checkRateLimit, getRequestIp } from "./rateLimit";

describe("checkRateLimit", () => {
  it("allows requests up to the limit within the window", () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit({ key, limit: 3, windowMs: 60_000 }).ok).toBe(true);
    }
  });

  it("rejects the request once the limit is exceeded within the window", () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ key, limit: 3, windowMs: 60_000 });
    }
    const result = checkRateLimit({ key, limit: 3, windowMs: 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RATE_LIMIT_ERROR");
      expect(result.error.details?.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("tracks distinct keys independently", () => {
    const keyA = `test:${crypto.randomUUID()}`;
    const keyB = `test:${crypto.randomUUID()}`;
    checkRateLimit({ key: keyA, limit: 1, windowMs: 60_000 });
    expect(checkRateLimit({ key: keyA, limit: 1, windowMs: 60_000 }).ok).toBe(false);
    expect(checkRateLimit({ key: keyB, limit: 1, windowMs: 60_000 }).ok).toBe(true);
  });

  it("resets once the window elapses", () => {
    // Fake timers, not a 1ms window and a real `setTimeout`. With
    // `windowMs: 1` the two synchronous calls below straddle a millisecond
    // boundary every so often, the window closes between them, and the
    // second call legitimately returns `ok: true` — a failure that says
    // nothing about the limiter and fails the suite at random.
    vi.useFakeTimers();
    try {
      const key = `test:${crypto.randomUUID()}`;
      expect(checkRateLimit({ key, limit: 1, windowMs: 1_000 }).ok).toBe(true);
      expect(checkRateLimit({ key, limit: 1, windowMs: 1_000 }).ok).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(checkRateLimit({ key, limit: 1, windowMs: 1_000 }).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getRequestIp", () => {
  it("reads the first entry of x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.4, 10.0.0.1" },
    });
    expect(getRequestIp(request)).toBe("203.0.113.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("https://example.com", { headers: { "x-real-ip": "203.0.113.9" } });
    expect(getRequestIp(request)).toBe("203.0.113.9");
  });

  it("falls back to a constant bucket when neither header is present", () => {
    const request = new Request("https://example.com");
    expect(getRequestIp(request)).toBe("unknown");
  });
});

describe("the memory cap must not become a rate-limit bypass", () => {
  /**
   * Regression for a pruner that deleted any bucket with
   * `now - windowStartedAt > 0` — true for every bucket created at least a
   * millisecond ago, so crossing `MAX_TRACKED_KEYS` flushed live windows
   * too. Anyone who could grow the map past the cap (rotating source IPs on
   * an anonymous route is enough) also reset every other caller's counter.
   */
  it("keeps an existing caller's window intact when a flood of new keys saturates the map", () => {
    const victim = `victim:${Math.random()}`;
    const limit = 2;
    const windowMs = 60_000;

    expect(checkRateLimit({ key: victim, limit, windowMs }).ok).toBe(true);
    expect(checkRateLimit({ key: victim, limit, windowMs }).ok).toBe(true);
    expect(checkRateLimit({ key: victim, limit, windowMs }).ok).toBe(false);

    // Flood well past MAX_TRACKED_KEYS (50_000) with distinct, still-live keys.
    for (let i = 0; i < 60_000; i++) {
      checkRateLimit({ key: `flood:${i}`, limit, windowMs });
    }

    // The victim's window never closed, so it is still refused — its counter
    // was not reset as a side effect of the flood.
    expect(checkRateLimit({ key: victim, limit, windowMs }).ok).toBe(false);
  });

  it("refuses a brand-new key rather than evicting a live one once saturated", () => {
    // Failing closed is the only option that bounds memory without resetting
    // somebody's live window; the refusal lands on the flood, not on the
    // callers already being tracked.
    const result = checkRateLimit({ key: `overflow:${Math.random()}`, limit: 100, windowMs: 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RATE_LIMIT_ERROR");
  });
});
