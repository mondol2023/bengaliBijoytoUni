"use client";

import { Progress } from "@/components/ui/Progress";
import type { UsageCheck } from "@/features/usage/usageService";
import { cn } from "@/lib/utils/cn";

export function UsageMeter({ usage }: { usage: UsageCheck }) {
  const ratio = usage.max === 0 ? 0 : usage.used / usage.max;
  const indicatorClassName = !usage.withinLimit
    ? "bg-danger"
    : ratio > 0.85
      ? "bg-warning"
      : "bg-accent";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-foreground/70">
        <span>
          {usage.used.toLocaleString()} / {usage.max.toLocaleString()} non-whitespace characters
          <span className="text-foreground/50"> · {usage.tier} tier</span>
        </span>
        <span className={cn(!usage.withinLimit && "font-semibold text-danger")}>
          {usage.withinLimit ? `${usage.remaining.toLocaleString()} remaining` : "Over limit"}
        </span>
      </div>
      <Progress value={Math.min(usage.used, usage.max)} max={usage.max} indicatorClassName={indicatorClassName} />
    </div>
  );
}
