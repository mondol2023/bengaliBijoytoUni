"use client";

import { useState } from "react";
import { RefreshCw, Star } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ANY_STATUS, useAdminFeedback, type FeedbackUpdate } from "@/hooks/useAdminFeedback";
import { FEEDBACK_LIMITS } from "@/lib/feedback/limits";
import { cn } from "@/lib/utils/cn";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { Feedback } from "@/lib/firebase/schemas";

type WithId<T> = T & { id: string };

const CATEGORY_LABELS: Record<Feedback["category"], string> = {
  wrong_conversion: "Wrong conversion",
  missing_character: "Missing character",
  file_problem: "File problem",
  bug: "Bug",
  feature_request: "Feature request",
  praise: "Praise",
  other: "Other",
};

const STATUS_OPTIONS = [
  { value: ANY_STATUS, label: "All statuses" },
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "resolved", label: "Resolved" },
];

const STATUS_TONES: Record<Feedback["status"], "danger" | "warning" | "success"> = {
  new: "danger",
  reviewed: "warning",
  resolved: "success",
};

const NEXT_STATUS: Record<Feedback["status"], Feedback["status"]> = {
  new: "reviewed",
  reviewed: "resolved",
  resolved: "new",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function FeedbackRow({
  entry,
  update,
}: {
  entry: WithId<Feedback>;
  update: (input: FeedbackUpdate) => Promise<SafeErrorResponse | null>;
}) {
  const [note, setNote] = useState(entry.adminNote ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNoteDirty = note !== (entry.adminNote ?? "");

  async function apply(input: FeedbackUpdate) {
    setIsSaving(true);
    setError(null);
    const failure = await update(input);
    if (failure) setError(failure.message);
    setIsSaving(false);
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONES[entry.status]}>{entry.status}</Badge>
        <Badge tone="accent">{CATEGORY_LABELS[entry.category]}</Badge>
        {entry.encodingId && <Badge tone="neutral">{entry.encodingId}</Badge>}
        {entry.rating !== null && (
          <span className="inline-flex items-center gap-0.5" aria-label={`Rated ${entry.rating} out of 5`}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Star
                key={value}
                className={cn(
                  "h-3.5 w-3.5",
                  value <= (entry.rating ?? 0) ? "fill-warning text-warning" : "text-foreground/25",
                )}
                aria-hidden
              />
            ))}
          </span>
        )}
        <span className="ml-auto text-xs text-foreground/40">{formatDate(entry.createdAt)}</span>
      </div>

      <p className="whitespace-pre-wrap text-sm text-foreground/85">{entry.message}</p>

      {(entry.sampleInput || entry.sampleOutput) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {entry.sampleInput && (
            <div className="rounded-md border border-border bg-surface-muted p-2">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-foreground/50">Legacy input</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">
                {entry.sampleInput}
              </pre>
            </div>
          )}
          {entry.sampleOutput && (
            <div className="rounded-md border border-border bg-surface-muted p-2">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-foreground/50">Unicode output</p>
              <pre className="font-bengali overflow-x-auto whitespace-pre-wrap break-words text-xs">
                {entry.sampleOutput}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/50">
        <span>{entry.userId ? `uid: ${entry.userId}` : "anonymous"}</span>
        {entry.email && <span>{entry.email}</span>}
        {entry.page && <span className="font-mono">{entry.page}</span>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <label className="flex-1">
          <span className="sr-only">Internal note</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={FEEDBACK_LIMITS.maxAdminNoteLength}
            rows={2}
            placeholder="Internal note (not shown to the reporter)…"
            className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm outline-none placeholder:text-foreground/40 focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!isNoteDirty || isSaving}
            onClick={() => apply({ id: entry.id, adminNote: note.trim() || null })}
          >
            Save note
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={isSaving}
            onClick={() => apply({ id: entry.id, status: NEXT_STATUS[entry.status] })}
          >
            Mark {NEXT_STATUS[entry.status]}
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </li>
  );
}

/** Complaint/review triage: read what came in, note what was done, close it out. */
export function AdminFeedbackList() {
  const { entries, isLoading, error, status, setStatus, update, refresh } = useAdminFeedback();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Feedback</h2>
        <div className="flex items-center gap-2">
          <Select
            value={status}
            onValueChange={setStatus}
            options={STATUS_OPTIONS}
            ariaLabel="Filter by triage status"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            loading={isLoading}
            leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}
          >
            Refresh
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-col rounded-lg border border-border bg-surface">
        <ul className="flex flex-col divide-y divide-border">
          {entries.length === 0 && !isLoading && (
            <li className="px-4 py-6 text-center text-xs text-foreground/50">
              No feedback for this filter yet.
            </li>
          )}
          {entries.map((entry) => (
            <FeedbackRow key={entry.id} entry={entry} update={update} />
          ))}
        </ul>
      </div>
    </div>
  );
}
