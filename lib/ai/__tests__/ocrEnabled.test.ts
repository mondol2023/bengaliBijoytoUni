import { afterEach, describe, expect, it, vi } from "vitest";
import { isOcrProviderEnabled } from "../enabled";

describe("isOcrProviderEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, "", "flase", "2", "no", "off"])("is false for %j", (value) => {
    vi.stubEnv("OCR_GEMINI_ENABLED", value);
    expect(isOcrProviderEnabled("gemini")).toBe(false);
  });

  it.each(["1", "true", " ON ", "Yes"])("is true for %j", (value) => {
    vi.stubEnv("OCR_GEMINI_ENABLED", value);
    expect(isOcrProviderEnabled("gemini")).toBe(true);
  });

  it("is per provider: enabling gemini does not enable openai", () => {
    vi.stubEnv("OCR_GEMINI_ENABLED", "true");
    expect(isOcrProviderEnabled("openai")).toBe(false);
  });

  it("is not armed by the transcription or resolution switches", () => {
    vi.stubEnv("AI_TRANSCRIPTION_ENABLED", "true");
    vi.stubEnv("AI_RESOLUTION_ENABLED", "true");
    vi.stubEnv("OCR_GEMINI_ENABLED", undefined);
    expect(isOcrProviderEnabled("gemini")).toBe(false);
  });
});
