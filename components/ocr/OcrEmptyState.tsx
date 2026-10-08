"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { OcrFileKind } from "@/features/ocr/job/fileKind";
import type { OcrJobState } from "@/features/ocr/job/jobState";
import type { OcrMode } from "@/features/ocr/types";
import { motionTokens } from "@/lib/motion/tokens";
import { skippedSummary } from "./OcrScannerBed";

/**
 * Everything the results sheet says when there is no row to show yet, or why the rows stop:
 * waiting, first run, nothing found, a stopped run, and a failed one. On an error or a stop the
 * rows that were read stay below it.
 */
export function OcrEmptyState({
  state,
  mode,
  fileKind,
  onReadPages,
  onRetry,
}: {
  state: OcrJobState;
  mode: OcrMode;
  fileKind: OcrFileKind | null;
  onReadPages: () => void;
  onRetry: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const outcomeCount = Object.keys(state.outcomes).length;
  const total = state.items.length;

  const collapse = reducedMotion
    ? {}
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: "auto" },
        transition: { duration: motionTokens.duration.fast, ease: motionTokens.easing.standard },
      };

  if (state.phase === "opening" || state.phase === "preparing") {
    return (
      <div className="flex min-h-40 flex-col gap-3 px-5 py-7">
        <p className="max-w-[52ch] text-[15px] leading-relaxed">
          The first time you use this page, your browser downloads the Bengali reading engine. It keeps it, so next
          time this step is instant.
        </p>
      </div>
    );
  }

  if (state.phase === "reading" && outcomeCount === 0) {
    return <p className="px-5 py-7 text-sm text-foreground/70">Lines appear here as soon as each one is read.</p>;
  }

  if (state.phase === "done" && total === 0) {
    const skipped = skippedSummary(state);
    return (
      <div className="flex min-h-56 flex-col gap-3.5 px-5 py-7">
        <p className="text-lg font-medium">No pictures of text in this file.</p>
        <p className="max-w-[56ch] text-sm leading-relaxed text-foreground/75">
          If its pages are scans, read them as whole pages instead. If the text looks like gibberish when you copy it,
          it is legacy-font text, and the Document converter handles that.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {fileKind === "pdf" && mode === "embedded" && <Button onClick={onReadPages}>Read whole pages</Button>}
          <Link
            href="/documents"
            className="text-sm underline decoration-border decoration-1 underline-offset-[5px] transition-colors hover:text-accent hover:decoration-accent"
          >
            Open the Document converter
          </Link>
        </div>
        {skipped && <p className="plate-marker">{skipped}</p>}
      </div>
    );
  }

  if (state.phase === "error" && state.error) {
    const failedUnreadable = state.unreadable;
    return (
        <motion.div key="error" {...collapse} className="overflow-hidden">
          <div role="alert" className="sheet-note border-t-0 bg-danger/10 text-danger">
            <AlertCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
            <span>{state.error.message}</span>
          </div>
          <div className="flex flex-col gap-2.5 border-t border-border p-4">
            {outcomeCount > 0 && (
              <p className="text-sm leading-relaxed text-foreground/80">
                Other failures keep the lines that were already read:
              </p>
            )}
            {failedUnreadable > 0 && (
              <p className="bg-warning/10 px-3 py-2.5 text-[13px] leading-normal text-warning">
                {failedUnreadable} {failedUnreadable === 1 ? "image" : "images"} could not be read and{" "}
                {failedUnreadable === 1 ? "was" : "were"} left out.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
              {total > 0 && (
                <span className="plate-marker">
                  {outcomeCount} of {total} lines kept
                </span>
              )}
            </div>
          </div>
        </motion.div>
    );
  }

  if (state.phase === "cancelled") {
    return (
        <motion.div key="cancelled" {...collapse} className="overflow-hidden">
          <p className="border-b border-border px-4 py-3 text-sm text-foreground/75">
            {outcomeCount > 0
              ? "Stopped. The lines already read are kept below."
              : "Stopped before anything was read."}
          </p>
        </motion.div>
    );
  }

  return null;
}
