"use client";

import { ReadoutStrip, type Readout } from "@/components/ui/ReadoutStrip";
import type { DiffResult } from "@/features/comparison/engine/diffEngine";
import type { SideSpelling } from "@/features/comparison/spelling/types";
import type { SpellcheckStatus } from "@/hooks/useSpellcheck";

/** One side's spelling figure: a count, or why there is no count. */
function typoReadout(label: string, side: SideSpelling | null, status: SpellcheckStatus): Readout {
  if (status === "unavailable") return { label, value: "n/a" };
  if (!side) return { label, value: "…" };
  if (side.skipped) return { label, value: "skipped" };
  const total = side.misspellings.length;
  return { label, value: total.toLocaleString(), tone: total > 0 ? "warning" : "ok" };
}

/**
 * The comparison's read-out row — the same instrument strip as the landing
 * page's Plate 04, so the figures a visitor saw on the specimen are the ones
 * they get here.
 *
 * `additions`/`removals` include modification halves too: from a summary
 * point of view, a modification is both something removed and something
 * added; "Modified" exists to show how many of those are paired edits.
 */
export function ComparisonStats({
  result,
  spelling,
}: {
  result: DiffResult;
  /** Omit (or pass status "off") to leave the spelling figures out. */
  spelling?: { status: SpellcheckStatus; source: SideSpelling | null; target: SideSpelling | null };
}) {
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
        ...(spelling && spelling.status !== "off"
          ? [
              typoReadout("Typos in", spelling.source, spelling.status),
              typoReadout("Typos out", spelling.target, spelling.status),
            ]
          : []),
      ]}
    />
  );
}
