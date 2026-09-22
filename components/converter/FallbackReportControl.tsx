"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { fallbackReportDraft } from "@/features/converter/feedbackDraft";
import type { RenderSegment } from "@/features/converter/runConversion";
import { cn } from "@/lib/utils/cn";

/**
 * The "this is wrong" control on a marked segment. It opens the ordinary
 * feedback form with the sequence and the substitution already filled in —
 * no new endpoint, no new collection, and no path by which the report
 * changes the resolution. An admin acts on it, or nothing happens.
 *
 * The draft decides whether the control exists at all: a clean or unresolved
 * run has no fallback to report.
 */
export function FallbackReportControl({
  encodingId,
  segment,
  className,
}: {
  encodingId: string;
  segment: RenderSegment;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const draft = fallbackReportDraft(encodingId, segment);
  if (!draft) return null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {open ? "Cancel report" : "Report this as wrong"}
      </button>

      {open && (
        <FeedbackForm
          encodingId={draft.encodingId}
          sampleInput={draft.sampleInput}
          sampleOutput={draft.sampleOutput}
          initialCategory={draft.category}
          initialMessage={draft.message}
        />
      )}
    </div>
  );
}
