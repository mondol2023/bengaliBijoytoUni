"use client";

import type { UsageCheck } from "@/features/usage/usageService";
import { cn } from "@/lib/utils/cn";

/**
 * How much of this conversion's character limit the input uses. A 2px square
 * rule rather than a rounded progress pill: it is a measure laid on the page,
 * terracotta while live, ochre near the limit, red once over it.
 */
export function UsageMeter({ usage, className }: { usage: UsageCheck; className?: string }) {
  const ratio = usage.max === 0 ? 0 : Math.min(1, usage.used / usage.max);
  const fill = !usage.withinLimit ? "bg-danger" : ratio > 0.85 ? "bg-warning" : "bg-accent";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-mono text-xs tabular-nums text-foreground/70">
          {usage.used.toLocaleString()} / {usage.max.toLocaleString()}
          <span className="text-foreground/50"> characters, spaces not counted</span>
        </span>
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            usage.withinLimit ? "text-foreground/70" : "font-semibold text-danger",
          )}
        >
          {usage.withinLimit ? `${usage.remaining.toLocaleString()} left` : "Over limit"}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Characters used"
        aria-valuemin={0}
        aria-valuemax={usage.max}
        aria-valuenow={Math.min(usage.used, usage.max)}
        className="relative h-0.5 w-full overflow-hidden bg-border"
      >
        <div
          className={cn("h-full origin-left transition-transform duration-300 ease-out", fill)}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
    </div>
  );
}
