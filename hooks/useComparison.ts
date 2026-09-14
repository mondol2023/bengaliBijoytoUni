"use client";

import { useMemo, useState } from "react";
import { useComparisonSide, type ComparisonSide } from "./useComparisonSide";
import { useDebouncedValue } from "./useDebouncedValue";
import { compareText, type DiffMode, type DiffResult } from "@/features/comparison/engine/diffEngine";
import { checkUsage, type UsageCheck } from "@/features/usage/usageService";
import type { TierId } from "@/types/domain";

const DEBOUNCE_MS = 250;

export interface UseComparisonResult {
  source: ComparisonSide;
  target: ComparisonSide;
  diffMode: DiffMode;
  setDiffMode: (mode: DiffMode) => void;
  tier: TierId;
  setTier: (tier: TierId) => void;
  sourceUsage: UsageCheck;
  targetUsage: UsageCheck;
  isPending: boolean;
  result: DiffResult | null;
  canCompare: boolean;
  clear: () => void;
}

/**
 * Owns comparison-page state: two independent input sides (each text-or-file,
 * see `useComparisonSide`), the shared tier/diff-mode controls, and the
 * debounced diff itself. `compareText` is pure, client-safe TS — no server
 * round-trip needed to diff, the same "engine runs in the browser" shape as
 * `useConversion`.
 */
export function useComparison(initialTier: TierId = "easy"): UseComparisonResult {
  const source = useComparisonSide();
  const target = useComparisonSide();
  const [diffMode, setDiffMode] = useState<DiffMode>("word");
  const [tier, setTier] = useState<TierId>(initialTier);

  const debouncedSourceText = useDebouncedValue(source.text, DEBOUNCE_MS);
  const debouncedTargetText = useDebouncedValue(target.text, DEBOUNCE_MS);
  const isPending = debouncedSourceText !== source.text || debouncedTargetText !== target.text;

  const sourceUsage = useMemo(() => checkUsage(debouncedSourceText, tier), [debouncedSourceText, tier]);
  const targetUsage = useMemo(() => checkUsage(debouncedTargetText, tier), [debouncedTargetText, tier]);

  const canCompare =
    debouncedSourceText.trim().length > 0 &&
    debouncedTargetText.trim().length > 0 &&
    sourceUsage.withinLimit &&
    targetUsage.withinLimit;

  const result = useMemo<DiffResult | null>(() => {
    if (!canCompare) return null;
    return compareText(diffMode, debouncedSourceText, debouncedTargetText);
  }, [canCompare, diffMode, debouncedSourceText, debouncedTargetText]);

  function clear() {
    source.clear();
    target.clear();
  }

  return {
    source,
    target,
    diffMode,
    setDiffMode,
    tier,
    setTier,
    sourceUsage,
    targetUsage,
    isPending,
    result,
    canCompare,
    clear,
  };
}
