/**
 * `SERVE_UNVERIFIED_AI` against the real flag module.
 *
 * `runConversion.test.ts` injects `serveUnverified` so the state machine can
 * be exercised both ways. That is the right shape for testing states and
 * the wrong shape for testing the flag: it proves what `runConversion` does
 * with a boolean, not what it does with the environment. This file never
 * passes the option, never mocks `lib/conversionFailures/serveFlags`, and
 * drives the real `process.env` instead — so a default that silently
 * flipped, or a flag read at import time rather than call time, fails here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runConversion } from "../runConversion";
import {
  SERVE_UNVERIFIED_AI_ENV,
  isServeUnverifiedAiEnabled,
} from "@/lib/conversionFailures/serveFlags";
import type { KnownResolution } from "@/lib/conversionFailures/knownResolutions";
import { TBD_LABEL } from "@/lib/conversionFailures/knownResolutions";

const UNMAPPED_BYTE = "¤";
const INPUT = `Av${UNMAPPED_BYTE}Kv`;

const UNVERIFIED: KnownResolution = {
  failedSequence: UNMAPPED_BYTE,
  candidateConversion: "ক",
  verification: "unverified",
  label: TBD_LABEL,
  engineVersion: "engine-test",
};

/** Deliberately no `serveUnverified`: the default is the thing under test. */
function runWithEnvDefault() {
  const result = runConversion({
    text: INPUT,
    encodingId: "bijoy",
    resolutions: { lookup: (sequence) => (sequence === UNMAPPED_BYTE ? UNVERIFIED : undefined) },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with SERVE_UNVERIFIED_AI off, no unverified fallback is ever returned", () => {
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
    it(`refuses it when the variable is ${name}`, () => {
      vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, value);
      expect(isServeUnverifiedAiEnabled()).toBe(false);

      const outcome = runWithEnvDefault();
      expect(outcome.state).toBe("unresolved");
      expect(outcome.segments.some((segment) => segment.state === "fallback_unverified")).toBe(
        false,
      );
      expect(outcome.segments.some((segment) => segment.label !== null)).toBe(false);
      expect(outcome.fallbacksApplied).toStrictEqual([]);
      // The gap is still a gap: raw bytes shown, sequence still reported.
      expect(outcome.unresolved.map((detail) => detail.sequence)).toStrictEqual([UNMAPPED_BYTE]);
    });
  }
});

describe("the case above is not vacuous", () => {
  for (const value of ["1", "true", "yes", "on", "TRUE", " true "]) {
    it(`applies the unverified fallback when the variable is ${JSON.stringify(value)}`, () => {
      vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, value);
      expect(isServeUnverifiedAiEnabled()).toBe(true);

      const result = runWithEnvDefault();
      expect(result.state).toBe("fallback_unverified");
      const filled = result.segments.find((segment) => segment.failedSequence !== null);
      expect(filled?.text).toBe("ক");
      expect(filled?.label).toStrictEqual(TBD_LABEL);
    });
  }
});

describe("the flag is read per call, not at import", () => {
  it("changes answer within one process without re-importing the module", () => {
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, "true");
    expect(runWithEnvDefault().state).toBe("fallback_unverified");

    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, "false");
    expect(runWithEnvDefault().state).toBe("unresolved");
  });
});
