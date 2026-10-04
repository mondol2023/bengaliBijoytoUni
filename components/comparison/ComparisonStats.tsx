"use client";

import { ReadoutStrip } from "@/components/ui/ReadoutStrip";
import type { DiffResult } from "@/features/comparison/engine/diffEngine";

/**
 * The comparison's read-out row — the same instrument strip as the landing
 * page's Plate 04, so the figures a visitor saw on the specimen are the ones
 * they get here.
 *
 * `additions`/`removals` include modification halves too: from a summary
 * point of view, a modification is both something removed and something
 * added; "Modified" exists to show how many of those are paired edits.
 */
export function ComparisonStats({ result }: { result: DiffResult }) {
  const additionsCount = result.additions.length + result.modifications.length;
  const removalsCount = result.removals.length + result.modifications.length;

  return (
    <ReadoutStrip
      size="lg"
      className="border-t border-border"
      readouts={[
        { label: "Similarity", value: `${Math.round(result.similarity * 100)}%` },
        { label: "Words in", value: result.statistics.sourceWords.toLocaleString() },
        { label: "Words out", value: result.statistics.targetWords.toLocaleString() },
        { label: "Added", value: additionsCount.toLocaleString() },
        { label: "Removed", value: removalsCount.toLocaleString() },
        { label: "Modified", value: result.modifications.length.toLocaleString() },
      ]}
    />
  );
}
