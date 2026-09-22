/**
 * The conversion the product runs: the engine first, then the resolution
 * store for what the engine could not map, and an output that is honest
 * about which is which.
 *
 * ## Order
 *
 * `convertLegacyText` runs first, on the whole input, every time. Not as a
 * cache check — as the answer. The store is consulted only for the
 * sequences `validation.unmappedDetails` reports. The engine is the thing
 * with provenance; a stored resolution is one admin's judgement about one
 * sequence. Running the engine first also means a table that has since
 * grown a rule wins automatically, with no invalidation logic, and it is
 * what makes the server-side re-verification in
 * `lib/conversionFailures/reverify.ts` free.
 *
 * ## No live AI call, ever
 *
 * Not as a fallback, not behind a flag, not for signed-in users. The only
 * way a resolution reaches a reader is that it was stored earlier and a
 * human accepted it. This module may not import `lib/ai` at all, and
 * `lib/ai/__tests__/callSites.test.ts` names it by path so that stays true.
 *
 * ## Synchronous, deliberately
 *
 * `runConversion` takes an already-built `ResolutionSource` and never
 * awaits anything. Step 2 of the lookup order — the cached snapshot — is a
 * network call, and the typing path must not wait on it. The snapshot is
 * fetched once when the encoding is chosen and applied to conversions after
 * it arrives; a conversion that happens before it lands is a conversion
 * with no fallbacks, re-rendered when the snapshot appears. The converter's
 * own output never waits.
 *
 * ## The validator runs again here
 *
 * Twice was the Phase 4 rule: before storing, and before serving. This is
 * the third, on the client, before rendering. It is a pure function already
 * in the bundle, so it costs nothing, and it is the only run that sees the
 * output text being assembled — insurance against a snapshot that was valid
 * when it was built being applied by a tab that has been open for a week
 * against a different engine.
 */
import { convertLegacyText, type ConversionOutput } from "./engine/pipeline";
import type { OutputSegment } from "./engine/segments";
import type { UnmappedDetail } from "./engine/validate";
import type { AppError, Result } from "@/lib/errors/types";
import { validateCandidateResolution } from "@/lib/conversionFailures/resolutionValidator";
import { isServeUnverifiedAiEnabled } from "@/lib/conversionFailures/serveFlags";
import type { KnownResolution } from "@/lib/conversionFailures/knownResolutions";
import type { KnownPatternsSnapshot } from "@/lib/conversionFailures/knownPatterns";
import type { Bilingual } from "@/lib/privacy/disclosure";

/**
 * The four states, worst last. A whole result reports the worst state any
 * of its segments is in: "some of this is unresolved" is not cancelled by
 * the rest of it being clean.
 */
export const FALLBACK_STATES = [
  "clean",
  "fallback_accepted",
  "fallback_unverified",
  "unresolved",
] as const;
export type FallbackState = (typeof FALLBACK_STATES)[number];

function worstOf(a: FallbackState, b: FallbackState): FallbackState {
  return FALLBACK_STATES.indexOf(a) >= FALLBACK_STATES.indexOf(b) ? a : b;
}

/** One run of output text, and what the reader must be told about it. */
export interface RenderSegment {
  readonly text: string;
  readonly state: FallbackState;
  /** The legacy bytes behind this run; non-null for a fallback or an unresolved run. */
  readonly failedSequence: string | null;
  /** Non-null exactly when `state` is `fallback_unverified`. Carried from the payload, never composed here. */
  readonly label: Bilingual | null;
  /** Offset of the run in `conversion.sourceText`. */
  readonly sourceIndex: number;
}

/** One resolution that was used, and how often. The caller decides whether to count it. */
export interface AppliedFallback {
  readonly failedSequence: string;
  readonly candidateConversion: string;
  readonly verification: "accepted" | "unverified";
  readonly occurrences: number;
}

/**
 * Step 1 of the lookup order: the in-memory map for this page, built once
 * per snapshot. A document with nine hundred instances of one bad sequence
 * does one lookup, not nine hundred.
 */
export interface ResolutionSource {
  /** Synchronous by contract. Anything needing I/O belongs in the snapshot fetch. */
  lookup(failedSequence: string): KnownResolution | undefined;
}

export interface RunConversionOptions {
  readonly text: string;
  readonly encodingId: string;
  /** Omitted on the server and before the snapshot lands; then there are simply no fallbacks. */
  readonly resolutions?: ResolutionSource;
  /**
   * Whether unreviewed entries may be applied. Defaults to the real flag.
   * Injectable so a test can prove the on-case is not vacuous; the default
   * is what ships.
   */
  readonly serveUnverified?: boolean;
}

export interface RunConversionResult {
  /** Exactly what the engine returned, unmodified. */
  readonly conversion: ConversionOutput;
  readonly segments: readonly RenderSegment[];
  readonly fallbacksApplied: readonly AppliedFallback[];
  /** The sequences still unmapped after the store was consulted. */
  readonly unresolved: readonly UnmappedDetail[];
  readonly state: FallbackState;
}

/** The empty source, for the server and for before a snapshot arrives. */
export const NO_RESOLUTIONS: ResolutionSource = { lookup: () => undefined };

/**
 * Builds the in-memory map from a snapshot. A snapshot for a different
 * encoding is ignored rather than merged — a resolution is keyed by
 * `(encodingId, failedSequence)`, and half a key is not a key.
 */
export function resolutionMapFrom(
  snapshot: KnownPatternsSnapshot | null | undefined,
  encodingId: string,
): ResolutionSource {
  if (!snapshot || snapshot.encodingId !== encodingId) return NO_RESOLUTIONS;
  const map = new Map<string, KnownResolution>();
  for (const resolution of snapshot.resolutions) {
    // First wins: the snapshot is ordered most-used first.
    if (!map.has(resolution.failedSequence)) map.set(resolution.failedSequence, resolution);
  }
  return { lookup: (failedSequence) => map.get(failedSequence) };
}

/** What one unmapped sequence resolved to, decided once and reused across its occurrences. */
interface SequenceDecision {
  readonly state: Exclude<FallbackState, "clean">;
  readonly text: string;
  readonly label: Bilingual | null;
  readonly resolution: KnownResolution | null;
}

function decide(
  failedSequence: string,
  rawText: string,
  encodingId: string,
  source: ResolutionSource,
  serveUnverified: boolean,
): SequenceDecision {
  const unresolved: SequenceDecision = {
    state: "unresolved",
    text: rawText,
    label: null,
    resolution: null,
  };

  const resolution = source.lookup(failedSequence);
  if (!resolution) return unresolved;

  // Fails closed: an unreviewed entry that reached the client anyway — from
  // a snapshot cached while the flag was on, say — is still refused here.
  if (resolution.verification === "unverified" && !serveUnverified) return unresolved;

  // The third run.
  const check = validateCandidateResolution({
    encodingId,
    failedSequence,
    candidateConversion: resolution.candidateConversion,
  });
  if (!check.valid) return unresolved;

  return {
    state: resolution.verification === "accepted" ? "fallback_accepted" : "fallback_unverified",
    text: resolution.candidateConversion,
    label: resolution.label,
    resolution,
  };
}

/**
 * Runs the engine, then fills what it could not map from the store.
 *
 * The error case is the engine's own — an unknown or missing encoding — and
 * is passed through unchanged, because a conversion that did not happen has
 * nothing to fall back to.
 */
export function runConversion(
  options: RunConversionOptions,
): Result<RunConversionResult, AppError> {
  const result = convertLegacyText(options.text, options.encodingId);
  if (!result.ok) return result;

  const conversion = result.value;
  const source = options.resolutions ?? NO_RESOLUTIONS;
  const serveUnverified = options.serveUnverified ?? isServeUnverifiedAiEnabled();

  if (conversion.validation.unmappedDetails.length === 0) {
    return {
      ok: true,
      value: {
        conversion,
        segments: conversion.outputSegments.map(toCleanSegment),
        fallbacksApplied: [],
        unresolved: [],
        state: "clean",
      },
    };
  }

  const decisions = new Map<string, SequenceDecision>();
  const occurrences = new Map<string, number>();
  const segments: RenderSegment[] = [];
  let state: FallbackState = "clean";

  for (const segment of conversion.outputSegments) {
    if (!segment.unmapped) {
      segments.push(toCleanSegment(segment));
      continue;
    }
    const failedSequence = segment.text;
    let decision = decisions.get(failedSequence);
    if (decision === undefined) {
      decision = decide(failedSequence, segment.text, options.encodingId, source, serveUnverified);
      decisions.set(failedSequence, decision);
    }
    occurrences.set(failedSequence, (occurrences.get(failedSequence) ?? 0) + 1);
    segments.push({
      text: decision.text,
      state: decision.state,
      failedSequence,
      label: decision.label,
      sourceIndex: segment.sourceIndex,
    });
    state = worstOf(state, decision.state);
  }

  const fallbacksApplied: AppliedFallback[] = [];
  for (const [failedSequence, decision] of decisions) {
    if (decision.resolution === null) continue;
    fallbacksApplied.push({
      failedSequence,
      candidateConversion: decision.resolution.candidateConversion,
      verification: decision.resolution.verification,
      occurrences: occurrences.get(failedSequence) ?? 0,
    });
  }

  // Reported as the engine reported them, minus the ones the store filled:
  // the fourth state must not get worse, and a caller that logs unresolved
  // sequences should log exactly the ones still unresolved.
  const filled = new Set(fallbacksApplied.map((fallback) => fallback.failedSequence));
  const unresolved = conversion.validation.unmappedDetails.filter(
    (detail) => !filled.has(detail.sequence),
  );

  return {
    ok: true,
    value: { conversion, segments, fallbacksApplied, unresolved, state },
  };
}

function toCleanSegment(segment: OutputSegment): RenderSegment {
  return {
    text: segment.text,
    state: "clean",
    failedSequence: null,
    label: null,
    sourceIndex: segment.sourceIndex,
  };
}
