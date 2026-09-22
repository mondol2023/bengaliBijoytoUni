"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { OccurrenceCountNote } from "@/components/admin/OccurrenceCountNote";
import { ANY_FILTER, DEFAULT_SORT, useAdminConversionFailures } from "@/hooks/useAdminConversionFailures";
import { FAILURE_CATEGORIES, type FailureCategory } from "@/features/converter/engine/classify";

export const CATEGORY_LABELS: Record<FailureCategory, string> = {
  unmapped_character: "Unmapped character",
  invalid_encoding: "Invalid encoding",
  reorder_defect: "Reorder defect",
  normalization_warning: "Normalization warning",
  ambiguous_typography: "Ambiguous typography",
  conversion_exception: "Conversion exception",
  document_extraction_failure: "Document extraction failure",
  unknown: "Unknown",
};

const CATEGORY_OPTIONS = [
  { value: ANY_FILTER, label: "All categories" },
  ...FAILURE_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
];

const STATUS_OPTIONS = [
  { value: ANY_FILTER, label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
];

/**
 * Two different questions, not a display preference: "recent" answers what is
 * happening now, "frequent" answers what is worth fixing. A pattern seen once
 * a minute ago outranks one seen nine hundred times this morning under the
 * first and is outranked under the second.
 */
const SORT_OPTIONS = [
  { value: DEFAULT_SORT, label: "Most recent" },
  { value: "frequent", label: "Most frequent" },
];

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Site-wide conversion-failure *patterns* — the aggregate view over
 * `conversionFailures` occurrences (see `docs/conversion-failure-pipeline.md`).
 * Deliberately shows only the pattern-level summary here, never a raw
 * occurrence's full text: that only ever renders on the per-pattern detail
 * page, one pattern at a time, which is also where AI resolution and review
 * happen.
 */
export function AdminConversionFailures() {
  const { patterns, summary, isLoading, error, filters, setFilters, refresh } = useAdminConversionFailures();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Conversion failures</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.failureCategory}
            onValueChange={(failureCategory) => setFilters({ ...filters, failureCategory })}
            options={CATEGORY_OPTIONS}
            ariaLabel="Filter by failure category"
          />
          <Select
            value={filters.status}
            onValueChange={(status) => setFilters({ ...filters, status })}
            options={STATUS_OPTIONS}
            ariaLabel="Filter by status"
          />
          <Select
            value={filters.sort}
            onValueChange={(sort) => setFilters({ ...filters, sort })}
            options={SORT_OPTIONS}
            ariaLabel="Sort patterns"
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

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Patterns</p>
          <p className="mt-1 text-2xl font-semibold">{summary.totalPatterns.toLocaleString()}</p>
        </div>
        {/* The counting note rides on this tile rather than on the header:
            it is a caveat about this number, and the three tiles beside it
            are unaffected by the change. */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Occurrences</p>
          <p className="mt-1 text-2xl font-semibold">{summary.totalOccurrences.toLocaleString()}</p>
          <OccurrenceCountNote className="mt-2" />
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Open</p>
          <p className="mt-1 text-2xl font-semibold text-warning">{summary.openCount.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Resolved</p>
          <p className="mt-1 text-2xl font-semibold text-success">{summary.resolvedCount.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-col rounded-lg border border-border bg-surface">
        <ul className="flex flex-col divide-y divide-border">
          {patterns.length === 0 && !isLoading && (
            <li className="px-4 py-6 text-center text-xs text-foreground/50">
              No conversion failures recorded yet.
            </li>
          )}
          {patterns.map((pattern) => (
            <li key={pattern.id} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={pattern.status === "open" ? "warning" : "success"}>
                  {pattern.status === "open" ? "Open" : "Resolved"}
                </Badge>
                <Badge tone="neutral">{CATEGORY_LABELS[pattern.failureCategory]}</Badge>
                {pattern.encodingId && <Badge tone="neutral">{pattern.encodingId}</Badge>}
                <Badge tone="accent">×{pattern.occurrenceCount.toLocaleString()}</Badge>
                <span className="ml-auto text-xs text-foreground/40">
                  last seen {formatDate(pattern.lastSeenAt)}
                </span>
              </div>

              <Link
                href={`/admin/conversion-failures/${pattern.id}`}
                className="w-fit font-mono text-sm text-foreground/80 underline-offset-2 hover:underline"
              >
                {pattern.failedSequence}
              </Link>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/50">
                <span>engine {pattern.engineVersion}</span>
                <span>first seen {formatDate(pattern.firstSeenAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
