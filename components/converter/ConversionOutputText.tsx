"use client";

import { Fragment } from "react";
import { FallbackReportControl } from "./FallbackReportControl";
import { describeSequence } from "@/features/converter/feedbackDraft";
import {
  conversionBreakdown,
  formatBreakdown,
} from "@/features/converter/fallbackPipeline";
import type { RenderSegment, RunConversionResult } from "@/features/converter/runConversion";
import { FALLBACK_ACCEPTED_LABEL } from "@/lib/conversionFailures/knownResolutions";
import type { Bilingual } from "@/lib/privacy/disclosure";

/**
 * The converted text in the output panel.
 *
 * With no `fallback` — the pipeline flag off — this is the pre-Phase-6
 * markup, character for character: one `<span lang="bn">` holding the
 * engine's text. `__tests__/conversionOutput.test.ts` pins that.
 *
 * With one, the same span holds the segments: clean runs as plain text, a
 * filled run marked and labelled, an unresolved run as the raw legacy bytes
 * in a monospace face, so a gap never passes for Bengali.
 */
export function ConversionOutputText({
  text,
  fallback,
}: {
  text: string;
  fallback: RunConversionResult | null;
}) {
  if (!fallback) return <span lang="bn">{text}</span>;

  return (
    <span lang="bn">
      {fallback.segments.map((segment, index) => {
        const key = `${segment.sourceIndex}:${index}`;
        const label = labelFor(segment);
        if (segment.state === "clean") return <Fragment key={key}>{segment.text}</Fragment>;
        if (segment.state === "unresolved" || label === null) {
          return (
            <span key={key} data-fallback-state="unresolved" className="font-mono text-danger">
              {segment.text}
            </span>
          );
        }
        return (
          <mark
            key={key}
            data-fallback-state={segment.state}
            title={`${label.en} / ${label.bn}`}
            className={
              segment.state === "fallback_accepted"
                ? "rounded-sm bg-accent-muted px-0.5 text-foreground underline decoration-dotted underline-offset-4"
                : "rounded-sm bg-warning/20 px-0.5 text-foreground underline decoration-wavy underline-offset-4"
            }
          >
            {segment.text}
          </mark>
        );
      })}
    </span>
  );
}

/**
 * Under the output, only when the pipeline is on: the breakdown line, then
 * one entry per filled sequence with its label in both languages and the
 * "this is wrong" control. One entry per sequence, not per occurrence — a
 * sequence filled nine hundred times was filled by one resolution.
 */
export function FallbackSummary({
  fallback,
  encodingId,
  wordCount,
}: {
  fallback: RunConversionResult;
  encodingId: string;
  wordCount: number;
}) {
  const filled = distinctFilled(fallback.segments);

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-foreground/70">
      <p data-testid="conversion-breakdown">{formatBreakdown(conversionBreakdown(fallback, wordCount))}</p>
      {filled.length > 0 && (
        <ul className="flex flex-col gap-3">
          {filled.map((segment) => {
            const label = labelFor(segment);
            return (
              <li
                key={segment.failedSequence}
                data-fallback-state={segment.state}
                className="flex flex-col gap-2 border border-border px-3 py-2"
              >
                {label && (
                  <p>
                    {label.en} · <span lang="bn">{label.bn}</span>
                  </p>
                )}
                <p className="font-mono">
                  {describeSequence(segment.failedSequence ?? "")} → <span lang="bn">{segment.text}</span>
                </p>
                <FallbackReportControl encodingId={encodingId} segment={segment} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The accepted label is ours; the unverified one travels with the payload and is never composed here. */
function labelFor(segment: RenderSegment): Bilingual | null {
  if (segment.state === "fallback_accepted") return FALLBACK_ACCEPTED_LABEL;
  if (segment.state === "fallback_unverified") return segment.label;
  return null;
}

function distinctFilled(segments: readonly RenderSegment[]): RenderSegment[] {
  const seen = new Set<string>();
  const filled: RenderSegment[] = [];
  for (const segment of segments) {
    if (segment.state !== "fallback_accepted" && segment.state !== "fallback_unverified") continue;
    if (segment.failedSequence === null || seen.has(segment.failedSequence)) continue;
    seen.add(segment.failedSequence);
    filled.push(segment);
  }
  return filled;
}
