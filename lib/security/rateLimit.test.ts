import { describe, expect, it } from "vitest";
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
    const key = `test:${crypto.randomUUID()}`;
    expect(checkRateLimit({ key, limit: 1, windowMs: 1 }).ok).toBe(true);
    expect(checkRateLimit({ key, limit: 1, windowMs: 1 }).ok).toBe(false);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit({ key, limit: 1, windowMs: 1 }).ok).toBe(true);
        resolve();
      }, 5);
    });
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
