"use client";

import { FileDiff, Minus, Plus, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import type { DiffResult } from "@/features/comparison/engine/diffEngine";

/**
 * `additions`/`removals` counts include modification halves too — from a
 * summary-stats point of view, a modification is both something removed and
 * something added; only the dedicated "modified" badge exists to show how
 * many of those are paired edits rather than unrelated changes.
 */
export function ComparisonStats({ result }: { result: DiffResult }) {
  const similarityPct = Math.round(result.similarity * 100);
  const additionsCount = result.additions.length + result.modifications.length;
  const removalsCount = result.removals.length + result.modifications.length;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Similarity</span>
        <span className="text-2xl font-semibold tabular-nums">{similarityPct}%</span>
      </div>
      <Progress value={similarityPct} max={100} />
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="neutral">
          <FileDiff className="h-3 w-3" aria-hidden />
          {result.statistics.sourceWords.toLocaleString()} → {result.statistics.targetWords.toLocaleString()} words
        </Badge>
        <Badge tone="success">
          <Plus className="h-3 w-3" aria-hidden />
          {additionsCount.toLocaleString()} added
        </Badge>
        <Badge tone="danger">
          <Minus className="h-3 w-3" aria-hidden />
          {removalsCount.toLocaleString()} removed
        </Badge>
        <Badge tone="accent">
          <Sparkles className="h-3 w-3" aria-hidden />
          {result.modifications.length.toLocaleString()} modified
        </Badge>
        <Badge tone="neutral">{result.statistics.changedWords.toLocaleString()} changed words</Badge>
      </div>
    </div>
  );
}
