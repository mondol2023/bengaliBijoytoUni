import { describe, expect, it } from "vitest";
import { ProviderErrors, providerErrorForHttpStatus, toSafeProviderError } from "./errors";

describe("ProviderErrors", () => {
  it("builds a provider_not_registered error with no provider id", () => {
    const error = ProviderErrors.notRegistered("search_ai");
    expect(error.code).toBe("provider_not_registered");
    expect(error.provider).toBeNull();
    expect(error.message).toContain("search_ai");
  });

  it("builds a provider_not_configured error naming the provider", () => {
    const error = ProviderErrors.notConfigured("gemini");
    expect(error.code).toBe("provider_not_configured");
    expect(error.provider).toBe("gemini");
  });

  it("never includes a message that echoes debug content", () => {
    const error = ProviderErrors.authenticationFailed("openai", { apiKey: "sk-super-secret" });
    expect(error.message).not.toContain("sk-super-secret");
  });
});

describe("toSafeProviderError", () => {
  it("strips debug but keeps everything else", () => {
    const error = ProviderErrors.timeout("gemini", { stack: "sensitive internal trace" });
    const safe = toSafeProviderError(error);
    expect(safe).not.toHaveProperty("debug");
    expect(JSON.stringify(safe)).not.toContain("sensitive internal trace");
    expect(safe.code).toBe("provider_timeout");
    expect(safe.provider).toBe("gemini");
  });
});

describe("providerErrorForHttpStatus", () => {
  it("maps 401/403 to authentication failure", () => {
    expect(providerErrorForHttpStatus("openai", 401).code).toBe("provider_authentication_failed");
    expect(providerErrorForHttpStatus("openai", 403).code).toBe("provider_authentication_failed");
  });

  it("maps 429 to rate limited", () => {
    expect(providerErrorForHttpStatus("gemini", 429).code).toBe("provider_rate_limited");
  });

  it("maps 5xx to unavailable", () => {
    expect(providerErrorForHttpStatus("gemini", 500).code).toBe("provider_unavailable");
    expect(providerErrorForHttpStatus("gemini", 503).code).toBe("provider_unavailable");
  });

  it("maps 400 to content rejected", () => {
    expect(providerErrorForHttpStatus("openai", 400).code).toBe("provider_content_rejected");
  });

  it("falls back to unknown_error for anything else", () => {
    expect(providerErrorForHttpStatus("openai", 418).code).toBe("provider_unknown_error");
  });
});
