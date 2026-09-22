/**
 * `runConversion`: the order, the four states, and the things that must
 * stay impossible.
 *
 * The state cases are written against a real conversion of real Bijoy
 * bytes, not a stubbed `ConversionOutput` — the whole point of the design
 * is that the engine runs first and the store only sees what it left over,
 * and a stub would let that ordering rot unnoticed.
 */
import { describe, expect, it, vi } from "vitest";
import {
  NO_RESOLUTIONS,
  resolutionMapFrom,
  runConversion,
  type ResolutionSource,
} from "../runConversion";
import type { KnownPatternsSnapshot } from "@/lib/conversionFailures/knownPatterns";
import type { KnownResolution } from "@/lib/conversionFailures/knownResolutions";
import { TBD_LABEL } from "@/lib/conversionFailures/knownResolutions";

/** "Av" is a Bijoy rule (আ); U+00A4 matches nothing in that table. */
const CLEAN_INPUT = "Av";
const UNMAPPED_BYTE = "¤";
const DIRTY_INPUT = `Av${UNMAPPED_BYTE}Kv`;

function resolution(overrides: Partial<KnownResolution> = {}): KnownResolution {
  return {
    failedSequence: UNMAPPED_BYTE,
    candidateConversion: "ক",
    verification: "accepted",
    label: null,
    engineVersion: "engine-test",
    ...overrides,
  };
}

function sourceOf(...resolutions: KnownResolution[]): ResolutionSource {
  const map = new Map(resolutions.map((entry) => [entry.failedSequence, entry]));
  return { lookup: (failedSequence) => map.get(failedSequence) };
}

function run(text: string, resolutions: ResolutionSource, serveUnverified = false) {
  const result = runConversion({ text, encodingId: "bijoy", resolutions, serveUnverified });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

describe("the engine runs first, on the whole input", () => {
  it("returns the engine's output untouched alongside the segments", () => {
    const value = run(DIRTY_INPUT, sourceOf(resolution()));
    const engineOnly = run(DIRTY_INPUT, NO_RESOLUTIONS);
    expect(value.conversion.unicodeText).toBe(engineOnly.conversion.unicodeText);
    expect(value.conversion.validation.unmappedDetails).toHaveLength(1);
  });

  it("never consults the store for a clean conversion", () => {
    const lookup = vi.fn();
    const value = run(CLEAN_INPUT, { lookup });
    expect(lookup).not.toHaveBeenCalled();
    expect(value.state).toBe("clean");
  });

  it("looks a repeated sequence up once, not once per occurrence", () => {
    const lookup = vi.fn(() => undefined);
    const repeated = `Av${UNMAPPED_BYTE}Kv${UNMAPPED_BYTE}Kv${UNMAPPED_BYTE}`;
    const value = run(repeated, { lookup });
    expect(value.segments.filter((segment) => segment.failedSequence !== null)).toHaveLength(3);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe("the four states", () => {
  it("clean: no unmapped sequences, no fallbacks, no unresolved", () => {
    const value = run(CLEAN_INPUT, sourceOf(resolution()));
    expect(value.state).toBe("clean");
    expect(value.fallbacksApplied).toStrictEqual([]);
    expect(value.unresolved).toStrictEqual([]);
    expect(value.segments.every((segment) => segment.state === "clean")).toBe(true);
  });

  it("fallback_accepted: the sequence is filled, marked, and unlabelled", () => {
    const value = run(DIRTY_INPUT, sourceOf(resolution()));
    expect(value.state).toBe("fallback_accepted");
    const filled = value.segments.find((segment) => segment.failedSequence !== null);
    expect(filled).toMatchObject({
      text: "ক",
      state: "fallback_accepted",
      failedSequence: UNMAPPED_BYTE,
      label: null,
    });
    expect(value.unresolved).toStrictEqual([]);
    expect(value.fallbacksApplied).toStrictEqual([
      {
        failedSequence: UNMAPPED_BYTE,
        candidateConversion: "ক",
        verification: "accepted",
        occurrences: 1,
      },
    ]);
  });

  it("fallback_unverified: filled only with the flag on, and it carries the label", () => {
    const unverified = resolution({ verification: "unverified", label: TBD_LABEL });
    const value = run(DIRTY_INPUT, sourceOf(unverified), true);
    expect(value.state).toBe("fallback_unverified");
    const filled = value.segments.find((segment) => segment.failedSequence !== null);
    expect(filled?.label).toStrictEqual(TBD_LABEL);
  });

  it("unresolved: the raw bytes survive, and are still reported", () => {
    const value = run(DIRTY_INPUT, NO_RESOLUTIONS);
    expect(value.state).toBe("unresolved");
    const left = value.segments.find((segment) => segment.failedSequence !== null);
    expect(left?.text).toBe(UNMAPPED_BYTE);
    expect(left?.state).toBe("unresolved");
    expect(value.unresolved.map((detail) => detail.sequence)).toStrictEqual([UNMAPPED_BYTE]);
  });

  it("reports the worst state present, not the last one seen", () => {
    // One sequence resolvable, one not. U+00A5 matches no Bijoy rule either.
    const other = "¥";
    const value = run(`Av${UNMAPPED_BYTE}Kv${other}`, sourceOf(resolution()));
    expect(value.state).toBe("unresolved");
    expect(value.fallbacksApplied).toHaveLength(1);
    expect(value.unresolved.map((detail) => detail.sequence)).toStrictEqual([other]);
  });
});

describe("a fallback never silently swallows a gap", () => {
  it("leaves the sequence unresolved when the stored candidate fails the validator", () => {
    // Latin letters are not a conversion of legacy Bengali: no_target_script.
    const bad = resolution({ candidateConversion: "nope" });
    const value = run(DIRTY_INPUT, sourceOf(bad));
    expect(value.state).toBe("unresolved");
    expect(value.fallbacksApplied).toStrictEqual([]);
    expect(value.unresolved).toHaveLength(1);
  });

  it("refuses an unverified entry when the flag is off, even if it is in the snapshot", () => {
    const unverified = resolution({ verification: "unverified", label: TBD_LABEL });
    const value = run(DIRTY_INPUT, sourceOf(unverified), false);
    expect(value.state).toBe("unresolved");
    expect(value.segments.some((segment) => segment.state === "fallback_unverified")).toBe(false);
  });

  it("matches a sequence exactly, never partially", () => {
    const value = run(DIRTY_INPUT, sourceOf(resolution({ failedSequence: `${UNMAPPED_BYTE}x` })));
    expect(value.state).toBe("unresolved");
  });

  it("keeps the rendered text equal to the engine's when nothing is filled", () => {
    const value = run(DIRTY_INPUT, NO_RESOLUTIONS);
    expect(value.segments.map((segment) => segment.text).join("")).toBe(
      value.conversion.unicodeText,
    );
  });
});

describe("the in-memory map", () => {
  function snapshot(overrides: Partial<KnownPatternsSnapshot> = {}): KnownPatternsSnapshot {
    return {
      encodingId: "bijoy",
      engineVersion: "engine-test",
      patterns: [],
      resolutions: [resolution()],
      generatedAt: new Date(0).toISOString(),
      ...overrides,
    };
  }

  it("indexes a snapshot by failed sequence", () => {
    const source = resolutionMapFrom(snapshot(), "bijoy");
    expect(source.lookup(UNMAPPED_BYTE)?.candidateConversion).toBe("ক");
  });

  it("ignores a snapshot built for a different encoding", () => {
    const source = resolutionMapFrom(snapshot({ encodingId: "sutonny" }), "bijoy");
    expect(source.lookup(UNMAPPED_BYTE)).toBeUndefined();
  });

  it("ignores a missing snapshot", () => {
    expect(resolutionMapFrom(null, "bijoy").lookup(UNMAPPED_BYTE)).toBeUndefined();
  });

  it("keeps the first of two entries for one sequence, the snapshot being ordered", () => {
    const source = resolutionMapFrom(
      snapshot({
        resolutions: [resolution(), resolution({ candidateConversion: "খ" })],
      }),
      "bijoy",
    );
    expect(source.lookup(UNMAPPED_BYTE)?.candidateConversion).toBe("ক");
  });
});

describe("the engine's errors are the caller's errors", () => {
  it("passes an unknown encoding straight through", () => {
    const result = runConversion({ text: "Av", encodingId: "not-an-encoding" });
    expect(result.ok).toBe(false);
  });

  it("passes a missing encoding straight through", () => {
    const result = runConversion({ text: "Av", encodingId: "" });
    expect(result.ok).toBe(false);
  });
});
