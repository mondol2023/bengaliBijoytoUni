/**
 * The limit-facing count against every fallback state.
 *
 * Phase 6 §4: a fallback counts as converted for usage and tier limits,
 * because the engine processed the full input; `fallback_unverified` counts
 * identically to `fallback_accepted`; an unresolved sequence counts the same
 * way, for the same reason. And the trust-facing breakdown — how many
 * sequences were filled, how many are still gaps — never moves that count.
 *
 * Each case runs the real conversion the hook runs (`computeConversion`), then
 * derives the count the way `useConversion` and `ConverterWorkspace` do, so a
 * change that made the count depend on what was filled fails here.
 */
import { describe, expect, it } from "vitest";
import { conversionUsageRecord } from "../conversionUsage";
import { checkUsage } from "../usageService";
import { computeConversion, conversionBreakdown } from "@/features/converter/fallbackPipeline";
import type { ResolutionSource, RunConversionResult } from "@/features/converter/runConversion";
import { TBD_LABEL, type KnownResolution } from "@/lib/conversionFailures/knownResolutions";
import { countWords } from "@/lib/utils/text";

const UNMAPPED_BYTE = "¤";
const INPUT = `Av${UNMAPPED_BYTE}Kv Av${UNMAPPED_BYTE}Kv`;
const CLEAN_INPUT = "Av Kv";

const ACCEPTED: KnownResolution = {
  failedSequence: UNMAPPED_BYTE,
  candidateConversion: "ক",
  verification: "accepted",
  label: null,
  engineVersion: "engine-test",
};
const UNVERIFIED: KnownResolution = { ...ACCEPTED, verification: "unverified", label: TBD_LABEL };

function source(resolution: KnownResolution | null): ResolutionSource {
  return { lookup: (sequence) => (resolution && sequence === UNMAPPED_BYTE ? resolution : undefined) };
}

interface Outcome {
  readonly fallback: RunConversionResult | null;
  readonly record: ReturnType<typeof conversionUsageRecord>;
}

/** One conversion, counted exactly as the converter page counts it. */
function convertAndCount(
  text: string,
  options: { pipelineEnabled: boolean; resolution?: KnownResolution | null; serveUnverified?: boolean },
): Outcome {
  const usage = checkUsage(text, "easy");
  expect(usage.withinLimit).toBe(true);
  const computed = computeConversion({
    text,
    encodingId: "bijoy",
    pipelineEnabled: options.pipelineEnabled,
    resolutions: source(options.resolution ?? null),
    serveUnverified: options.serveUnverified ?? false,
  });
  expect(computed.output).not.toBeNull();
  return {
    fallback: computed.fallback,
    record: conversionUsageRecord({ encodingId: "bijoy", usage, wordCount: countWords(text) }),
  };
}

function inputCount(text: string) {
  return { charCount: checkUsage(text, "easy").used, wordCount: countWords(text) };
}

describe("§4: what counts toward usage and tier limits", () => {
  it("a normal conversion counts as converted, pipeline off or on", () => {
    for (const pipelineEnabled of [false, true]) {
      const { fallback, record } = convertAndCount(CLEAN_INPUT, { pipelineEnabled });
      if (pipelineEnabled) expect(fallback?.state).toBe("clean");
      expect(record).toMatchObject({ status: "success", error: null, ...inputCount(CLEAN_INPUT) });
      expect(record.charCount).toBeGreaterThan(0);
    }
  });

  it("fallback_accepted counts as converted: the full input, as a success", () => {
    const { fallback, record } = convertAndCount(INPUT, { pipelineEnabled: true, resolution: ACCEPTED });
    expect(fallback?.state).toBe("fallback_accepted");
    expect(record).toMatchObject({ status: "success", error: null, ...inputCount(INPUT) });
  });

  it("fallback_unverified counts identically to fallback_accepted", () => {
    const accepted = convertAndCount(INPUT, { pipelineEnabled: true, resolution: ACCEPTED });
    const unverified = convertAndCount(INPUT, {
      pipelineEnabled: true,
      resolution: UNVERIFIED,
      serveUnverified: true,
    });
    expect(unverified.fallback?.state).toBe("fallback_unverified");
    expect(unverified.record).toStrictEqual(accepted.record);
  });

  it("unresolved input counts as converted too: the engine still processed all of it", () => {
    const accepted = convertAndCount(INPUT, { pipelineEnabled: true, resolution: ACCEPTED });
    const noResolution = convertAndCount(INPUT, { pipelineEnabled: true, resolution: null });
    // An unverified entry with SERVE_UNVERIFIED_AI off is withheld, so it is a gap.
    const withheld = convertAndCount(INPUT, { pipelineEnabled: true, resolution: UNVERIFIED });
    for (const outcome of [noResolution, withheld]) {
      expect(outcome.fallback?.state).toBe("unresolved");
      expect(outcome.record).toStrictEqual(accepted.record);
    }
    // And the same as the pre-Phase-6 converter, which had no fallbacks at all.
    expect(convertAndCount(INPUT, { pipelineEnabled: false }).record).toStrictEqual(accepted.record);
  });

  it("the trust-facing breakdown differs by state while the limit-facing count does not", () => {
    const outcomes = [
      convertAndCount(INPUT, { pipelineEnabled: true, resolution: ACCEPTED }),
      convertAndCount(INPUT, { pipelineEnabled: true, resolution: UNVERIFIED, serveUnverified: true }),
      convertAndCount(INPUT, { pipelineEnabled: true, resolution: null }),
    ];
    const breakdowns = outcomes.map(({ fallback }) => {
      if (!fallback) throw new Error("expected the pipeline to run");
      const { filled, unresolved } = conversionBreakdown(fallback, countWords(INPUT));
      return { filled, unresolved };
    });
    expect(breakdowns).toStrictEqual([
      { filled: 2, unresolved: 0 },
      { filled: 2, unresolved: 0 },
      { filled: 0, unresolved: 2 },
    ]);
    expect(new Set(outcomes.map(({ record }) => JSON.stringify(record))).size).toBe(1);
  });

  it("takes nothing from the fallback result, so the breakdown has no way into the count", () => {
    // The parameter type is the whole contract: usage, word count, encoding.
    // A fallback result smuggled in alongside them is ignored.
    const usage = checkUsage(INPUT, "easy");
    const base = { encodingId: "bijoy", usage, wordCount: countWords(INPUT) };
    const withFallbackAttached = {
      ...base,
      fallback: convertAndCount(INPUT, { pipelineEnabled: true, resolution: null }).fallback,
    };
    expect(conversionUsageRecord(withFallbackAttached)).toStrictEqual(conversionUsageRecord(base));
  });
});
