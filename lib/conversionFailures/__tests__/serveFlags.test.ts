/**
 * A flag whose default decides whether unreviewed model output reaches
 * users deserves the same treatment as the one guarding paid calls: every
 * way of getting it wrong must land on "off".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVE_UNVERIFIED_AI_ENV, isServeUnverifiedAiEnabled } from "../serveFlags";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isServeUnverifiedAiEnabled", () => {
  it("is off when the variable is not set", () => {
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, undefined);
    expect(isServeUnverifiedAiEnabled()).toBe(false);
  });

  it("is off for empty, whitespace and near-misses", () => {
    for (const raw of ["", "   ", "0", "false", "no", "off", "TRUEISH", "yes please", "1 "]) {
      vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, raw);
      expect(isServeUnverifiedAiEnabled(), JSON.stringify(raw)).toBe(raw.trim() === "1");
    }
  });

  it("is on only for the four words it documents, in any case", () => {
    for (const raw of ["1", "true", "TRUE", "Yes", " on "]) {
      vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, raw);
      expect(isServeUnverifiedAiEnabled(), raw).toBe(true);
    }
  });

  it("reads the variable at call time, not at import time", () => {
    // So a deployment that injects environment variables after module
    // evaluation still gets the setting it configured.
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, "true");
    expect(isServeUnverifiedAiEnabled()).toBe(true);
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, "false");
    expect(isServeUnverifiedAiEnabled()).toBe(false);
  });

  it("does not collide with the flag guarding outbound calls", () => {
    expect(SERVE_UNVERIFIED_AI_ENV).toBe("SERVE_UNVERIFIED_AI");
  });
});
