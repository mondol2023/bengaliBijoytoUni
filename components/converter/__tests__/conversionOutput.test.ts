/**
 * What the output panel renders, with the fallback pipeline off and on.
 *
 * Vitest runs in `node` here, so components are rendered to markup with
 * `react-dom/server` rather than mounted. That is enough for what is being
 * proved: which elements, which text, which labels — not interaction.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversionOutputText, FallbackSummary } from "../ConversionOutputText";
import { computeConversion, conversionBreakdown, formatBreakdown } from "@/features/converter/fallbackPipeline";
import { convertLegacyText } from "@/features/converter/engine/pipeline";
import type { ResolutionSource, RunConversionResult } from "@/features/converter/runConversion";
import { checkUsage } from "@/features/usage/usageService";
import {
  FALLBACK_ACCEPTED_LABEL,
  TBD_LABEL,
  type KnownResolution,
} from "@/lib/conversionFailures/knownResolutions";
import { countWords } from "@/lib/utils/text";

const UNMAPPED_BYTE = "¤";
const INPUT = `Av${UNMAPPED_BYTE}Kv Av${UNMAPPED_BYTE}Kv`;
const CLEAN_INPUT = "Av Kv";

function source(resolution: KnownResolution | null): ResolutionSource {
  return { lookup: (sequence) => (resolution && sequence === UNMAPPED_BYTE ? resolution : undefined) };
}

const ACCEPTED: KnownResolution = {
  failedSequence: UNMAPPED_BYTE,
  candidateConversion: "ক",
  verification: "accepted",
  label: null,
  engineVersion: "engine-test",
};
const UNVERIFIED: KnownResolution = { ...ACCEPTED, verification: "unverified", label: TBD_LABEL };

function pipelineOn(
  text: string,
  resolution: KnownResolution | null,
  serveUnverified = false,
): RunConversionResult {
  const computed = computeConversion({
    text,
    encodingId: "bijoy",
    pipelineEnabled: true,
    resolutions: source(resolution),
    serveUnverified,
  });
  if (!computed.fallback) throw new Error("expected the pipeline to run");
  return computed.fallback;
}

function renderText(text: string, fallback: RunConversionResult | null): string {
  return renderToStaticMarkup(createElement(ConversionOutputText, { text, fallback }));
}

function renderSummary(fallback: RunConversionResult, text: string): string {
  return renderToStaticMarkup(
    createElement(FallbackSummary, { fallback, encodingId: "bijoy", wordCount: countWords(text) }),
  );
}

/** HTML-escapes the way React does, for the characters these fixtures contain. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

describe("flag off: the output is the pre-Phase-6 markup", () => {
  for (const [name, text] of [
    ["clean input", CLEAN_INPUT],
    ["input with an unmapped byte", INPUT],
  ] as const) {
    it(`renders exactly <span lang="bn">{output.unicodeText}</span> for ${name}`, () => {
      const computed = computeConversion({
        text,
        encodingId: "bijoy",
        pipelineEnabled: false,
        resolutions: source(ACCEPTED),
      });
      expect(computed.fallback).toBeNull();
      const unicodeText = computed.output?.unicodeText ?? "";

      // What ConverterWorkspace rendered before Phase 6, built independently.
      const before = convertLegacyText(text, "bijoy");
      if (!before.ok) throw new Error("unreachable");
      const prePhase6 = renderToStaticMarkup(createElement("span", { lang: "bn" }, before.value.unicodeText));

      const markup = renderText(unicodeText, computed.fallback);
      expect(markup).toBe(prePhase6);
      expect(markup).toBe(`<span lang="bn">${escape(before.value.unicodeText)}</span>`);
      expect(markup).not.toContain("data-fallback-state");
      expect(markup).not.toContain("<mark");
    });
  }
});

describe("flag on: each of the four states renders", () => {
  it("clean: plain text, nothing marked, and the same markup as flag off", () => {
    const fallback = pipelineOn(CLEAN_INPUT, ACCEPTED);
    expect(fallback.state).toBe("clean");
    const markup = renderText(fallback.conversion.unicodeText, fallback);
    expect(markup).toBe(renderText(fallback.conversion.unicodeText, null));

    const summary = renderSummary(fallback, CLEAN_INPUT);
    expect(summary).toContain("2 words converted · 0 filled from stored resolutions · 0 unresolved");
    expect(summary).not.toContain("Report this as wrong");
  });

  it("fallback_accepted: the filled text is marked and carries FALLBACK_ACCEPTED_LABEL", () => {
    const fallback = pipelineOn(INPUT, ACCEPTED);
    expect(fallback.state).toBe("fallback_accepted");
    const markup = renderText(fallback.conversion.unicodeText, fallback);
    expect(markup).toMatch(/<mark data-fallback-state="fallback_accepted"[^>]*>ক<\/mark>/);
    expect(markup).toContain(`title="${FALLBACK_ACCEPTED_LABEL.en} / ${FALLBACK_ACCEPTED_LABEL.bn}"`);
    expect(markup).not.toContain(UNMAPPED_BYTE);

    const summary = renderSummary(fallback, INPUT);
    expect(summary).toContain("2 words converted · 2 filled from stored resolutions · 0 unresolved");
    expect(summary).toContain(FALLBACK_ACCEPTED_LABEL.en);
    expect(summary).toContain(`<span lang="bn">${FALLBACK_ACCEPTED_LABEL.bn}</span>`);
    expect(summary).toContain("U+00A4");
    // One entry and one report control per sequence, not per occurrence.
    expect(summary.match(/Report this as wrong/g)).toHaveLength(1);
  });

  it("fallback_unverified, behind its own flag: marked differently, with the payload's label", () => {
    const fallback = pipelineOn(INPUT, UNVERIFIED, true);
    expect(fallback.state).toBe("fallback_unverified");
    const markup = renderText(fallback.conversion.unicodeText, fallback);
    expect(markup).toMatch(/<mark data-fallback-state="fallback_unverified"[^>]*>ক<\/mark>/);
    expect(markup).toContain(`title="${TBD_LABEL.en} / ${TBD_LABEL.bn}"`);
    expect(markup).not.toContain(FALLBACK_ACCEPTED_LABEL.en);

    const summary = renderSummary(fallback, INPUT);
    expect(summary).toContain("2 filled from stored resolutions · 0 unresolved");
    expect(summary).toContain(TBD_LABEL.en);
    expect(summary.match(/Report this as wrong/g)).toHaveLength(1);
  });

  it("fallback_unverified with its own flag off renders as unresolved, not as a fill", () => {
    const fallback = pipelineOn(INPUT, UNVERIFIED, false);
    expect(fallback.state).toBe("unresolved");
    const markup = renderText(fallback.conversion.unicodeText, fallback);
    expect(markup).not.toContain("<mark");
    expect(markup).not.toContain(TBD_LABEL.en);
  });

  it("unresolved: the raw legacy bytes, monospace, never passed off as Bengali", () => {
    const fallback = pipelineOn(INPUT, null);
    expect(fallback.state).toBe("unresolved");
    const markup = renderText(fallback.conversion.unicodeText, fallback);
    expect(markup.match(/<span data-fallback-state="unresolved" class="font-mono[^"]*">¤<\/span>/g)).toHaveLength(2);
    expect(markup).not.toContain("<mark");

    const summary = renderSummary(fallback, INPUT);
    expect(summary).toContain("2 words converted · 0 filled from stored resolutions · 2 unresolved");
    expect(summary).not.toContain("Report this as wrong");
  });
});

describe("usage: a fill costs what the conversion costs", () => {
  it("checkUsage and the word count are the same whatever the store filled", () => {
    const outcomes = [
      pipelineOn(INPUT, null),
      pipelineOn(INPUT, ACCEPTED),
      pipelineOn(INPUT, UNVERIFIED, true),
      pipelineOn(INPUT, UNVERIFIED, false),
    ];
    expect(new Set(outcomes.map((outcome) => outcome.state))).toStrictEqual(
      new Set(["unresolved", "fallback_accepted", "fallback_unverified"]),
    );
    // The limit is measured on the input, which no state changes.
    const usage = checkUsage(INPUT, "easy");
    for (const outcome of outcomes) {
      expect(checkUsage(outcome.conversion.sourceText, "easy")).toStrictEqual(usage);
      expect(conversionBreakdown(outcome, countWords(INPUT)).wordsConverted).toBe(countWords(INPUT));
    }
  });

  it("formats the breakdown line with grouped numbers", () => {
    expect(formatBreakdown({ wordsConverted: 1240, filled: 12, unresolved: 3 })).toBe(
      `${(1240).toLocaleString()} words converted · 12 filled from stored resolutions · 3 unresolved`,
    );
    expect(formatBreakdown({ wordsConverted: 1, filled: 0, unresolved: 0 })).toBe(
      "1 word converted · 0 filled from stored resolutions · 0 unresolved",
    );
  });
});
