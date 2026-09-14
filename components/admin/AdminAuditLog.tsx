"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAdminAudit } from "@/hooks/useAdminAudit";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminAuditLog() {
  const { entries, isLoading, error, refresh } = useAdminAudit();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Audit log</h2>
        <Button variant="ghost" size="sm" onClick={refresh} loading={isLoading} leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}>
          Refresh
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-col rounded-lg border border-border bg-surface">
        <ul className="flex flex-col divide-y divide-border">
          {entries.length === 0 && !isLoading && (
            <li className="px-4 py-6 text-center text-xs text-foreground/50">No admin actions recorded yet.</li>
          )}
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{entry.action}</Badge>
                  <span className="text-sm font-medium">{entry.target}</span>
                </div>
                <span className="text-xs text-foreground/40">{formatDate(entry.createdAt)}</span>
              </div>
              <span className="text-xs text-foreground/60">by {entry.actorUid}</span>
              {Object.keys(entry.metadata).length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded bg-surface-muted p-2 text-xs text-foreground/70">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
