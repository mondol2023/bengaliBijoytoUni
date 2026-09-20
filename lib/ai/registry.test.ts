import { describe, expect, it } from "vitest";
import { getResolutionProvider, listResolutionProviders } from "./registry";

describe("getResolutionProvider", () => {
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
