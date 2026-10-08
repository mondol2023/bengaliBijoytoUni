import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_RESOLUTION_ENABLED_ENV } from "./enabled";
import { getOcrProviders, getResolutionProvider, listResolutionProviders } from "./registry";

/**
 * Every lookup below is about *which* provider comes back, so each one needs
 * the deployment-wide switch on. Its off state is a behavior in its own right
 * and gets its own block at the bottom rather than being the ambient default
 * these cases have to work around.
 */
describe("getResolutionProvider", () => {
  beforeEach(() => {
    vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the gemini provider for a valid id", () => {
    const result = getResolutionProvider("gemini");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("gemini");
  });

  it("returns the openai provider for a valid id", () => {
    const result = getResolutionProvider("openai");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("openai");
  });

  it("returns a controlled provider_not_registered error for an unknown id, never a silent fallback", () => {
    const result = getResolutionProvider("search_ai");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("provider_not_registered");
      expect(result.error.provider).toBeNull();
    }
  });

  it("returns provider_not_registered for a typo/garbage id", () => {
    const result = getResolutionProvider("gemni");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_not_registered");
  });
});

describe("getResolutionProvider when AI resolution is disabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a valid provider id when the flag is unset", () => {
    vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, undefined);
    const result = getResolutionProvider("gemini");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_disabled");
  });

  it("hands back no provider object at all, so there is nothing to call", () => {
    vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, undefined);
    const result = getResolutionProvider("gemini");
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
  });

  it.each(["", " ", "0", "false", "no", "off", "TRU", "yes please", "enabled"])(
    "stays disabled for the non-affirmative value %o",
    (value) => {
      vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, value);
      const result = getResolutionProvider("gemini");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("provider_disabled");
    },
  );

  it.each(["1", "true", "TRUE", "True", " true ", "yes", "on"])(
    "enables only for the affirmative value %o",
    (value) => {
      vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, value);
      expect(getResolutionProvider("gemini").ok).toBe(true);
    },
  );

  it("reports disabled rather than not-registered for an unknown id, so the registry's contents stay unprobeable", () => {
    vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, undefined);
    const result = getResolutionProvider("search_ai");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_disabled");
  });
});

describe("listResolutionProviders", () => {
  it("lists every registered provider", () => {
    const ids = listResolutionProviders().map((provider) => provider.id);
    expect(ids.sort()).toEqual(["gemini", "openai"]);
  });
});

describe("provider not-configured behavior", () => {
  it("reports isConfigured() false when no API key is set in the environment", () => {
    // This test suite never sets GEMINI_API_KEY/OPENAI_API_KEY, matching the
    // requirement that a missing key must never crash — only report
    // unconfigured — and that the main test run never needs real credentials.
    for (const provider of listResolutionProviders()) {
      if (!process.env.GEMINI_API_KEY && provider.id === "gemini") {
        expect(provider.isConfigured()).toBe(false);
      }
      if (!process.env.OPENAI_API_KEY && provider.id === "openai") {
        expect(provider.isConfigured()).toBe(false);
      }
    }
  });
});

describe("getOcrProviders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled when no OCR provider switch is on, whatever the other switches say", () => {
    vi.stubEnv("OCR_GEMINI_ENABLED", undefined);
    vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, "true");
    vi.stubEnv("AI_TRANSCRIPTION_ENABLED", "true");
    const result = getOcrProviders();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    if (!result.ok) expect(result.error.code).toBe("provider_disabled");
  });

  it("returns the Gemini adapter when its switch is on", () => {
    vi.stubEnv("OCR_GEMINI_ENABLED", "true");
    const result = getOcrProviders();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((p) => p.id)).toEqual(["gemini"]);
  });
});
