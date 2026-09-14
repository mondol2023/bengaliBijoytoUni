"use client";

import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ANY_FILTER, useAdminErrors } from "@/hooks/useAdminErrors";
import type { ErrorLog } from "@/lib/firebase/schemas";

const KIND_LABELS: Record<ErrorLog["kind"], string> = {
  unmapped_character: "Unmapped letters",
  conversion_failed: "Conversion failed",
  file_extraction_failed: "File unreadable",
  validation_warning: "Output warning",
  limit_exceeded: "Limit exceeded",
  rate_limited: "Rate limited",
  unknown: "Unexpected failure",
};

const KIND_OPTIONS = [
  { value: ANY_FILTER, label: "All kinds" },
  ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
];

const SEVERITY_OPTIONS = [
  { value: ANY_FILTER, label: "All severities" },
  { value: "error", label: "Errors only" },
  { value: "warning", label: "Warnings only" },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Site-wide failure log. The point of this page is the `topSamples` strip:
 * the legacy sequences failing most often across all users are the mapping
 * rules worth fixing next.
 */
export function AdminErrorLog() {
  const { entries, summary, isLoading, error, filters, setFilters, refresh } = useAdminErrors();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Error log</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.kind}
            onValueChange={(kind) => setFilters({ ...filters, kind })}
            options={KIND_OPTIONS}
            ariaLabel="Filter by failure kind"
          />
          <Select
            value={filters.severity}
            onValueChange={(severity) => setFilters({ ...filters, severity })}
            options={SEVERITY_OPTIONS}
            ariaLabel="Filter by severity"
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

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Occurrences</p>
          <p className="mt-1 text-2xl font-semibold">{summary.total.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Errors</p>
          <p className="mt-1 text-2xl font-semibold text-danger">
            {(summary.bySeverity.error ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Warnings</p>
          <p className="mt-1 text-2xl font-semibold text-warning">
            {(summary.bySeverity.warning ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      {summary.topSamples.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-semibold">Most frequently failing sequences</p>
          <p className="text-xs text-foreground/60">
            Across the most recent {entries.length.toLocaleString()} entries — the mapping rules worth
            fixing first.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {summary.topSamples.map(({ sample, count }) => (
              <span
                key={sample}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 py-1"
              >
                <code className="font-mono text-xs">{sample}</code>
                <span className="text-xs text-foreground/50">×{count.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col rounded-lg border border-border bg-surface">
        <ul className="flex flex-col divide-y divide-border">
          {entries.length === 0 && !isLoading && (
            <li className="px-4 py-6 text-center text-xs text-foreground/50">
              No failures recorded for this filter.
            </li>
          )}
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={entry.severity === "error" ? "danger" : "warning"}>
                  {KIND_LABELS[entry.kind]}
                </Badge>
                <Badge tone="neutral">{entry.source}</Badge>
                {entry.encodingId && <Badge tone="neutral">{entry.encodingId}</Badge>}
                {entry.occurrences > 1 && <Badge tone="accent">×{entry.occurrences}</Badge>}
                <span className="ml-auto text-xs text-foreground/40">{formatDate(entry.createdAt)}</span>
              </div>

              <p className="text-sm text-foreground/80">{entry.message}</p>

              {entry.samples.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {entry.samples.map((sample) => (
                    <code
                      key={sample}
                      className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs"
                    >
                      {sample}
                    </code>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/50">
                <span className="font-mono">{entry.code}</span>
                {entry.fileName && (
                  <span>
                    file: <span className="font-mono">{entry.fileName}</span>
                    {entry.fileType ? ` (${entry.fileType})` : ""}
                  </span>
                )}
                {entry.route && <span className="font-mono">{entry.route}</span>}
                <span>{entry.userId ? `uid: ${entry.userId}` : "anonymous"}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
