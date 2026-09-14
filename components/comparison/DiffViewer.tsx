"use client";

import { Minus, Plus } from "lucide-react";
import type { DiffResult } from "@/features/comparison/engine/diffEngine";
import { cn } from "@/lib/utils/cn";

/**
 * Renders `result.segments` — already in original document order — as one
 * inline unified diff (word mode) or a stack of labeled paragraph blocks
 * (paragraph mode). Deliberately never relies on color alone to carry
 * meaning: added text is underlined plus an sr-only/visible "Added" label,
 * removed text is struck through plus a "Removed" label, on top of the
 * success/danger color coding.
 */
export function DiffViewer({ result }: { result: DiffResult }) {
  if (result.segments.length === 0) {
    return <p className="p-4 text-sm text-foreground/40">Nothing to show — both sides are empty.</p>;
  }

  if (result.mode === "paragraph") {
    return (
      <div role="group" aria-label="Comparison result, paragraph mode" className="flex flex-col gap-2 p-4">
        {result.segments.map((segment, index) => {
          if (segment.type === "unchanged") {
            return (
              <div
                key={index}
                className="font-bengali whitespace-pre-wrap break-words rounded-md border-l-4 border-transparent px-3 py-2 text-base leading-relaxed"
              >
                {segment.value}
              </div>
            );
          }

          const isAdded = segment.type === "added";
          const Icon = isAdded ? Plus : Minus;

          return (
            <div
              key={index}
              className={cn(
                "font-bengali whitespace-pre-wrap break-words rounded-md border-l-4 px-3 py-2 text-base leading-relaxed",
                isAdded ? "border-success bg-success/10" : "border-danger bg-danger/10",
              )}
            >
              <span
                className={cn(
                  "mb-1 flex items-center gap-1 text-xs font-semibold",
                  isAdded ? "text-success" : "text-danger",
                )}
              >
                <Icon className="h-3 w-3" aria-hidden />
                {isAdded ? "Added" : "Removed"}
              </span>
              <span className={isAdded ? "underline decoration-success/50" : "line-through decoration-danger/50"}>
                {segment.value}
              </span>
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
      className="font-bengali whitespace-pre-wrap break-words p-4 text-base leading-relaxed"
    >
      {result.segments.map((segment, index) => {
        if (segment.type === "unchanged") {
          return <span key={index}>{segment.value}</span>;
        }

        const isAdded = segment.type === "added";
        return (
          <span
            key={index}
            className={cn(
              "rounded-sm px-0.5",
              isAdded
                ? "bg-success/15 text-success underline decoration-success/60"
                : "bg-danger/15 text-danger line-through decoration-danger/60",
            )}
          >
            <span className="sr-only">{isAdded ? "Added: " : "Removed: "}</span>
            {segment.value}
          </span>
        );
      })}
    </div>
  );
}
