"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils/cn";

export function Progress({
  value,
  max = 100,
  className,
  indicatorClassName,
}: {
  value: number;
  max?: number;
  className?: string;
  indicatorClassName?: string;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <ProgressPrimitive.Root
      value={value}
      max={max || 1}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-surface-muted", className)}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 bg-accent transition-transform duration-300 ease-out", indicatorClassName)}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
