"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { detectEncoding, type ConversionOutput } from "@/features/converter/engine/pipeline";
import { convertMixedLegacy } from "@/features/converter/engine/mixedText";
import {
  computeConversion,
  fallbackFailureIssue,
  snapshotRequest,
} from "@/features/converter/fallbackPipeline";
import { recordIssue } from "@/lib/log/reportIssue";
import { loadResolutionSource } from "@/features/converter/resolutionSource";
import type { ResolutionSource, RunConversionResult } from "@/features/converter/runConversion";
import { isFallbackPipelineEnabled } from "@/lib/conversionFailures/serveFlags";
import { listEncodings } from "@/features/converter/encodings/registry";
import type { EncodingDefinition } from "@/features/converter/encodings/types";
import { checkUsage, type UsageCheck } from "@/features/usage/usageService";
import { countWords } from "@/lib/utils/text";
import type { TierId } from "@/types/domain";
import type { AppError } from "@/lib/errors/types";
import { AUTO_DETECT, type EncodingChoice } from "@/features/converter/constants";

export { AUTO_DETECT, type EncodingChoice };

export interface UseConversionResult {
  inputText: string;
  setInputText: (text: string) => void;
  encodingChoice: EncodingChoice;
  setEncodingChoice: (choice: EncodingChoice) => void;
  tier: TierId;
  setTier: (tier: TierId) => void;
  encodings: EncodingDefinition[];
  /** What auto-detect currently guesses, regardless of the active choice. */
  detectedEncodingId: string | undefined;
  detectionConfidence: number;
  /** The encoding id actually driving conversion right now. */
  resolvedEncodingId: string | undefined;
  /**
   * The encodings the text was split between, when auto-detect found it set in
   * two legacy fonts at once (see `engine/mixedText.ts`); null otherwise.
   * `resolvedEncodingId` is then the one covering most of the text.
   */
  mixedEncodingIds: string[] | null;
  usage: UsageCheck;
  isOverLimit: boolean;
  isPending: boolean;
  output: ConversionOutput | null;
  error: AppError | null;
  /**
   * The fallback pipeline's view of `output`: null whenever
   * `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` is off, and then the converter is
   * exactly what it was before Phase 6. `output` is the engine's either way.
   */
  fallback: RunConversionResult | null;
  wordCount: number;
  clear: () => void;
}

const DEBOUNCE_MS = 200;

/**
 * Owns all client-side converter state: input text, encoding selection
 * (manual or auto-detect), tier, and the derived, debounced conversion
 * result. Runs entirely through the framework-independent engine in
 * `features/converter` — this hook is just wiring for the UI.
 */
export function useConversion(initialTier: TierId = "easy"): UseConversionResult {
  const [inputText, setInputText] = useState("");

  const [encodingChoice, setEncodingChoice] = useState<EncodingChoice>(AUTO_DETECT);
  const [tier, setTier] = useState<TierId>(initialTier);

  const debouncedText = useDebouncedValue(inputText, DEBOUNCE_MS);
  const isPending = debouncedText !== inputText;
  const encodings = useMemo(() => listEncodings(), []);

  const detection = useMemo(() => detectEncoding(debouncedText), [debouncedText]);
  const usage = useMemo(() => checkUsage(debouncedText, tier), [debouncedText, tier]);

  // Only auto-detect splits a text between fonts: an explicit choice is an
  // instruction to convert all of it with that table. Skipped past the tier
  // limit, where nothing is converted anyway.
  const mixed = useMemo(
    () =>
      encodingChoice === AUTO_DETECT && usage.withinLimit && debouncedText.length > 0
        ? convertMixedLegacy(debouncedText)
        : null,
    [encodingChoice, usage.withinLimit, debouncedText],
  );
  const mixedOutput = mixed?.ok ? mixed.value : null;
  const mixedEncodingIds = mixedOutput ? Object.keys(mixedOutput.convertedChars) : null;

  const resolvedEncodingId =
    encodingChoice !== AUTO_DETECT
      ? encodingChoice
      : mixedOutput
        ? mixedOutput.encodingId
        : detection.encodingId;

  // Deliberately on the live text, not the debounced text — a word count that
  // lags the caret reads as a bug. Memoized so it only re-scans when the text
  // actually changes, rather than on every unrelated re-render of the page.
  const wordCount = useMemo(() => countWords(inputText), [inputText]);

  // Stable identity, so a memoized toolbar does not re-render on every keystroke.
  const clearInput = useCallback(() => setInputText(""), []);

  // Fixed at build time (it is a NEXT_PUBLIC_ variable), so reading it on
  // every render costs nothing and cannot change between renders.
  const pipelineEnabled = isFallbackPipelineEnabled();

  // The snapshot, fetched once per encoding and never awaited by the typing
  // path: until it lands, conversions simply have no fallbacks. Off, there is
  // no request at all. Tagged with the encoding it was built for, so a
  // snapshot still in flight when the encoding changes is never applied.
  const [loaded, setLoaded] = useState<{ encodingId: string; source: ResolutionSource } | null>(
    null,
  );
  useEffect(() => {
    const request = snapshotRequest(pipelineEnabled, resolvedEncodingId);
    if (!request) return;
    const controller = new AbortController();
    void loadResolutionSource({ ...request, signal: controller.signal }).then((source) => {
      if (!controller.signal.aborted) setLoaded({ encodingId: request.encodingId, source });
    });
    return () => controller.abort();
  }, [pipelineEnabled, resolvedEncodingId]);
  const resolutions =
    loaded !== null && loaded.encodingId === resolvedEncodingId ? loaded.source : undefined;

  const { output, error, fallback, fallbackFailed } = useMemo((): {
    output: ConversionOutput | null;
    error: AppError | null;
    fallback: RunConversionResult | null;
    fallbackFailed: boolean;
  } => {
    const none = { output: null, error: null, fallback: null, fallbackFailed: false };
    if (debouncedText.length === 0) return none;
    if (!usage.withinLimit) return none;
    if (!resolvedEncodingId) return none;
    if (mixed) {
      return mixed.ok
        ? { output: mixed.value, error: null, fallback: null, fallbackFailed: false }
        : { output: null, error: mixed.error, fallback: null, fallbackFailed: false };
    }

    return computeConversion({
      text: debouncedText,
      encodingId: resolvedEncodingId,
      pipelineEnabled,
      resolutions,
    });
  }, [debouncedText, resolvedEncodingId, usage.withinLimit, pipelineEnabled, resolutions, mixed]);

  // A pipeline that threw has already degraded to the engine's own output
  // (`computeConversion`); this only makes the failure visible to whoever
  // reads `errorLogs`. Outside render, and merged by `recordIssue`, so one
  // tab posts it once per encoding however often it recurs.
  useEffect(() => {
    if (fallbackFailed) recordIssue(fallbackFailureIssue(resolvedEncodingId ?? null));
  }, [fallbackFailed, resolvedEncodingId]);

  return {
    inputText,
    setInputText,
    encodingChoice,
    setEncodingChoice,
    tier,
    setTier,
    encodings,
    detectedEncodingId: detection.encodingId,
    detectionConfidence: detection.confidence,
    resolvedEncodingId,
    mixedEncodingIds,
    usage,
    isOverLimit: !usage.withinLimit,
    isPending,
    output,
    error,
    fallback,
    wordCount,
    clear: clearInput,
  };
}
