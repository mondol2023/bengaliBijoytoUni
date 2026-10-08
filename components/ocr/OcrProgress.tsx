"use client";

import { motion } from "motion/react";
import { MicroButton } from "@/components/ui/MicroButton";
import { Progress } from "@/components/ui/Progress";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { OcrJobState } from "@/features/ocr/job/jobState";
import { stageLine } from "@/features/ocr/job/view";
import { motionTokens } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";

/** Stage line, Cancel, and a 2px bar: indeterminate while the file opens and the reader loads. */
export function OcrProgress({
  state,
  onCancel,
  className,
  padded = true,
}: {
  state: OcrJobState;
  onCancel: () => void;
  className?: string;
  /** Inset the stage line to the sheet gutter; off where the parent already supplies one. */
  padded?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const total = state.items.length;
  const indeterminate = state.phase === "opening" || state.phase === "preparing" || total === 0;

  return (
    <div className={className}>
      <div className={cn("flex items-center justify-between gap-3", padded && "px-4")}>
        <span className="text-sm text-foreground/70">{stageLine(state)}</span>
        <MicroButton onClick={onCancel}>Cancel</MicroButton>
      </div>
      {indeterminate ? (
        <div
          role="progressbar"
          aria-label={state.phase === "opening" ? "Opening the file" : state.phase === "preparing" ? "Preparing the reader" : "Starting the reader"}
          className="relative h-0.5 overflow-hidden bg-surface-muted"
        >
          {reducedMotion ? (
            <span className="absolute inset-0 bg-accent opacity-40" />
          ) : (
            <motion.span
              className="absolute inset-y-0 w-[30%] bg-accent"
              initial={{ left: "-30%" }}
              animate={{ left: "100%" }}
              transition={{
                duration: motionTokens.duration.deliberate * 2,
                ease: motionTokens.easing.standard,
                repeat: Infinity,
              }}
            />
          )}
        </div>
      ) : (
        <Progress
          value={Object.keys(state.outcomes).length}
          max={total}
          aria-label="Items read"
          className="h-0.5 rounded-none"
        />
      )}
    </div>
  );
}
