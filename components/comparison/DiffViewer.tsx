"use client";

import type { DiffResult } from "@/features/comparison/engine/diffEngine";
import { cn } from "@/lib/utils/cn";

/**
 * Renders `result.segments` — already in original document order — as one
 * inline unified diff (word mode) or a ruled list of paragraphs (paragraph
 * mode). The marks match the landing page's diff specimen. Meaning never
 * rests on colour alone: added text is underlined and removed text struck
 * through, with an sr-only (word mode) or visible mono (paragraph mode) label
 * on top of the green/red ledger colours.
 */
export function DiffViewer({ result }: { result: DiffResult }) {
  if (result.segments.length === 0) {
    return <p className="p-4 text-sm text-foreground/70">Nothing to show — both sides are empty.</p>;
  }

  if (result.mode === "paragraph") {
    return (
      <div role="group" aria-label="Comparison result, paragraph mode" className="flex flex-col">
        {result.segments.map((segment, index) => {
          const isAdded = segment.type === "added";
          const isChanged = segment.type !== "unchanged";

          return (
            <div
              key={index}
              className={cn(
                "rule-row grid gap-x-6 gap-y-1 px-4 py-4 sm:grid-cols-[6rem_1fr] sm:px-6",
                isChanged && (isAdded ? "bg-success/5" : "bg-danger/5"),
              )}
            >
              <span
                className={cn(
                  "font-mono text-[0.7rem] uppercase tracking-[0.14em] sm:pt-1.5",
                  !isChanged ? "text-foreground/60" : isAdded ? "text-success" : "text-danger",
                )}
              >
                {!isChanged ? "Same" : isAdded ? "Added" : "Removed"}
              </span>
              <p
                className={cn(
                  "max-w-[75ch] whitespace-pre-wrap break-words font-bengali text-lg leading-[1.9]",
                  isChanged &&
                    (isAdded
                      ? "text-success underline decoration-success decoration-1 underline-offset-4"
                      : "text-danger line-through decoration-danger decoration-1"),
                )}
              >
                {segment.value}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Comparison result, word mode"
      className="max-w-[75ch] whitespace-pre-wrap break-words p-4 font-bengali text-lg leading-[1.9] sm:p-6"
    >
      {result.segments.map((segment, index) => {
        if (segment.type === "unchanged") {
          return <span key={index}>{segment.value}</span>;
        }

        const isAdded = segment.type === "added";
        return (
          <span
            key={index}
            className={
              isAdded
                ? "bg-success/10 text-success underline decoration-success decoration-1 underline-offset-4"
                : "text-danger line-through decoration-danger decoration-1"
            }
          >
            <span className="sr-only">{isAdded ? "Added: " : "Removed: "}</span>
            {segment.value}
          </span>
        );
      })}
    </div>
  );
}
