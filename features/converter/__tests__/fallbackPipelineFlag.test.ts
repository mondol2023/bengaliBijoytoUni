/**
 * `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` against the real flag module.
 *
 * The pattern of `runConversionFlag.test.ts`, applied to the rollout flag:
 * nothing here mocks `lib/conversionFailures/serveFlags`, and every case
 * reads the flag the way `useConversion` does — `isFallbackPipelineEnabled()`
 * at call time — while driving the real `process.env`. So a default that
 * silently flipped, or a flag read at import time, fails here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeConversion, snapshotRequest } from "../fallbackPipeline";
import { convertLegacyText } from "../engine/pipeline";
import {
  ENABLE_FALLBACK_PIPELINE_ENV,
  isFallbackPipelineEnabled,
} from "@/lib/conversionFailures/serveFlags";
import type { KnownResolution } from "@/lib/conversionFailures/knownResolutions";

const UNMAPPED_BYTE = "¤";
const INPUT = `Av${UNMAPPED_BYTE}Kv`;

const ACCEPTED: KnownResolution = {
  failedSequence: UNMAPPED_BYTE,
  candidateConversion: "ক",
  verification: "accepted",
  label: null,
  engineVersion: "engine-test",
};

/** Deliberately no `pipelineEnabled` literal: the env is the thing under test. */
function convertAsTheHookDoes() {
  return computeConversion({
    text: INPUT,
    encodingId: "bijoy",
    pipelineEnabled: isFallbackPipelineEnabled(),
    resolutions: { lookup: (sequence) => (sequence === UNMAPPED_BYTE ? ACCEPTED : undefined) },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with the pipeline flag off, the converter is the pre-Phase-6 converter", () => {
  const off = [
    ["unset", undefined],
    ["empty", ""],
    ["false", "false"],
    ["zero", "0"],
    ["off", "off"],
    ["a typo", "ture"],
    ["a half-written value", "tru"],
  ] as const;

  for (const [name, value] of off) {
    it(`calls the engine alone and fetches nothing when the variable is ${name}`, () => {
      vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, value);
      expect(isFallbackPipelineEnabled()).toBe(false);

      const computed = convertAsTheHookDoes();
      const engine = convertLegacyText(INPUT, "bijoy");
      if (!engine.ok) throw new Error("unreachable");

      // Exactly what the hook returned before Phase 6, even with a resolution on offer
      // (`fallbackFailed` is the pipeline's own failure signal, and is false when it is off).
      expect(computed).toStrictEqual({ output: engine.value, error: null, fallback: null, fallbackFailed: false });
      expect(computed.output?.unicodeText).toContain(UNMAPPED_BYTE);
      expect(snapshotRequest(isFallbackPipelineEnabled(), "bijoy")).toBeNull();
    });
  }
});

describe("the case above is not vacuous", () => {
  for (const value of ["1", "true", "yes", "on", "TRUE", " true "]) {
    it(`runs the pipeline and requests a snapshot when the variable is ${JSON.stringify(value)}`, () => {
      vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, value);
      expect(isFallbackPipelineEnabled()).toBe(true);

      const computed = convertAsTheHookDoes();
      expect(computed.fallback?.state).toBe("fallback_accepted");
      expect(computed.fallback?.segments.some((segment) => segment.text === "ক")).toBe(true);
      // `output` is still the engine's own, gaps included.
      expect(computed.output).toBe(computed.fallback?.conversion);
      expect(computed.output?.unicodeText).toContain(UNMAPPED_BYTE);

      const request = snapshotRequest(isFallbackPipelineEnabled(), "bijoy");
      expect(request?.encodingId).toBe("bijoy");
      // The same rules hash the engine stamps on its output, so the snapshot cache key matches.
      expect(request?.rulesHash).toBe(computed.output?.rulesHash);
    });
  }
});

describe("the flag is read per call, not at import", () => {
  it("changes answer within one process without re-importing the module", () => {
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, "true");
    expect(convertAsTheHookDoes().fallback).not.toBeNull();

    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, "false");
    expect(convertAsTheHookDoes().fallback).toBeNull();
  });
});

describe("snapshotRequest", () => {
  it("asks for nothing without an encoding, or for one the registry does not know", () => {
    expect(snapshotRequest(true, undefined)).toBeNull();
    expect(snapshotRequest(true, "no-such-encoding")).toBeNull();
  });
});
