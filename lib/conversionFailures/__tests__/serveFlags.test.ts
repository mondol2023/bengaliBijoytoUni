/**
 * A flag whose default decides whether unreviewed model output reaches
 * users deserves the same treatment as the one guarding paid calls: every
 * way of getting it wrong must land on "off".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENABLE_FALLBACK_PIPELINE_ENV,
  SERVE_UNVERIFIED_AI_ENV,
  isFallbackPipelineEnabled,
  isServeUnverifiedAiEnabled,
} from "../serveFlags";

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

describe("isFallbackPipelineEnabled", () => {
  it("is off when the variable is not set", () => {
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, undefined);
    expect(isFallbackPipelineEnabled()).toBe(false);
  });

  it("is off for empty, whitespace and near-misses", () => {
    for (const raw of ["", "   ", "0", "false", "no", "off", "TRUEISH", "yes please", "1 "]) {
      vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, raw);
      expect(isFallbackPipelineEnabled(), JSON.stringify(raw)).toBe(raw.trim() === "1");
    }
  });

  it("is on only for the four words it documents, in any case", () => {
    for (const raw of ["1", "true", "TRUE", "Yes", " on "]) {
      vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, raw);
      expect(isFallbackPipelineEnabled(), raw).toBe(true);
    }
  });

  it("reads the variable at call time, not at import time", () => {
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, "true");
    expect(isFallbackPipelineEnabled()).toBe(true);
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, "false");
    expect(isFallbackPipelineEnabled()).toBe(false);
  });

  it("is independent of SERVE_UNVERIFIED_AI, in both directions", () => {
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, "true");
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, undefined);
    expect(isFallbackPipelineEnabled()).toBe(false);
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, undefined);
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, "true");
    expect(isServeUnverifiedAiEnabled()).toBe(false);
  });

  it("is read by the literal spelling Next.js inlines into a browser bundle", () => {
    // A computed `process.env[ENABLE_FALLBACK_PIPELINE_ENV]` passes every
    // test above under Node and is permanently off in a browser.
    const source = readFileSync(path.join(__dirname, "..", "serveFlags.ts"), "utf8");
    expect(source).toContain("process.env.NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE)");
    expect(ENABLE_FALLBACK_PIPELINE_ENV).toBe("NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE");
  });

  it("is declared off in every environment template the repository ships", () => {
    // `.env.local` itself is never read here. The templates are what a new
    // environment is built from, so each must carry the flag empty.
    const root = path.join(__dirname, "..", "..", "..");
    for (const file of [".env.local.example", ".env.development.local.example"]) {
      const lines = readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
      const entries = lines.filter((line) => line.startsWith(`${ENABLE_FALLBACK_PIPELINE_ENV}=`));
      expect(entries, file).toStrictEqual([`${ENABLE_FALLBACK_PIPELINE_ENV}=`]);
    }
  });
});
