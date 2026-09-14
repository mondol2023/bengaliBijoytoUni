"use client";

import { useCallback, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  convertLegacyText,
  detectEncoding,
  type ConversionOutput,
} from "@/features/converter/engine/pipeline";
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
  usage: UsageCheck;
  isOverLimit: boolean;
  isPending: boolean;
  output: ConversionOutput | null;
  error: AppError | null;
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
  const resolvedEncodingId =
    encodingChoice === AUTO_DETECT ? detection.encodingId : encodingChoice;

  const usage = useMemo(() => checkUsage(debouncedText, tier), [debouncedText, tier]);

  // Deliberately on the live text, not the debounced text — a word count that
  // lags the caret reads as a bug. Memoized so it only re-scans when the text
  // actually changes, rather than on every unrelated re-render of the page.
  const wordCount = useMemo(() => countWords(inputText), [inputText]);

  // Stable identity, so a memoized toolbar does not re-render on every keystroke.
  const clearInput = useCallback(() => setInputText(""), []);

  const { output, error } = useMemo((): {
    output: ConversionOutput | null;
    error: AppError | null;
  } => {
    if (debouncedText.length === 0) return { output: null, error: null };
    if (!usage.withinLimit) return { output: null, error: null };
    if (!resolvedEncodingId) return { output: null, error: null };

    const result = convertLegacyText(debouncedText, resolvedEncodingId);
    return result.ok ? { output: result.value, error: null } : { output: null, error: result.error };
  }, [debouncedText, resolvedEncodingId, usage.withinLimit]);

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
    usage,
    isOverLimit: !usage.withinLimit,
    isPending,
    output,
    error,
    wordCount,
    clear: clearInput,
  };
}
