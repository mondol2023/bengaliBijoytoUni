"use client";

import { useState } from "react";
import { RefreshCw, Search, ShieldBan, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { useAdminUsers, type UserPatch } from "@/hooks/useAdminUsers";
import { listTiers } from "@/features/usage/tierConfig";
import type { AdminUserRow } from "@/app/api/admin/users/route";
import type { TierId } from "@/types/domain";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function AdminUsersTable() {
  const { users, nextPageToken, isLoading, error, search, loadMore, refresh, updateUser } = useAdminUsers();
  const [searchValue, setSearchValue] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Users</h2>
        <div className="flex items-center gap-2">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              search(searchValue);
            }}
          >
            <input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search by exact email…"
              className="h-9 w-56 rounded-md border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button type="submit" variant="secondary" size="sm" leftIcon={<Search className="h-4 w-4" aria-hidden />}>
              Search
            </Button>
          </form>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchValue("");
              refresh();
            }}
            loading={isLoading}
            leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-foreground/50">
        Browsing shows 50 users at a time; search matches an exact email address only (the Admin SDK has no partial-match lookup).
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-foreground/50">
            <tr>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Usage override</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Joined</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-foreground/50">
                  No users found.
                </td>
              </tr>
            )}
            {users.map((row) => (
              <UserRow key={row.uid} row={row} onUpdate={(patch) => updateUser(row.uid, patch)} />
            ))}
          </tbody>
        </table>
      </div>

      {nextPageToken && (
        <Button variant="secondary" size="sm" onClick={() => void loadMore()} className="self-center">
          Load more
        </Button>
      )}
    </div>
  );
}

function UserRow({ row, onUpdate }: { row: AdminUserRow; onUpdate: (patch: UserPatch) => Promise<{ message: string } | null> }) {
  const [overrideInput, setOverrideInput] = useState(row.usageOverrideMaxChars?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function apply(patch: UserPatch) {
    setBusy(true);
    setRowError(null);
    const result = await onUpdate(patch);
    setBusy(false);
    if (result) setRowError(result.message);
  }

  return (
    <tr>
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="font-medium">{row.email ?? row.uid}</span>
          {row.isAdmin && <Badge tone="accent" className="mt-1 w-fit">admin</Badge>}
        </div>
        {rowError && <p className="mt-1 text-xs text-danger">{rowError}</p>}
      </td>
      <td className="px-3 py-2">
        <Select
          value={row.tier}
          onValueChange={(value) => void apply({ tier: value as TierId })}
          options={listTiers().map((tier) => ({ value: tier.id, label: tier.label }))}
          ariaLabel={`Tier for ${row.email ?? row.uid}`}
          className="min-w-32"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            value={overrideInput}
            onChange={(event) => setOverrideInput(event.target.value)}
            placeholder="tier default"
            className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              const parsed = Number(overrideInput);
              void apply({ usageOverrideMaxChars: overrideInput.trim() === "" || Number.isNaN(parsed) ? null : parsed });
            }}
          >
            Save
          </Button>
        </div>
      </td>
      <td className="px-3 py-2">
        <Badge tone={row.disabled ? "danger" : "success"}>{row.disabled ? "Disabled" : "Active"}</Badge>
      </td>
      <td className="px-3 py-2 text-foreground/60">{formatDate(row.createdAt)}</td>
      <td className="px-3 py-2 text-right">
        <Button
          variant={row.disabled ? "secondary" : "danger"}
          size="sm"
          disabled={busy}
          onClick={() => void apply({ disabled: !row.disabled })}
          leftIcon={row.disabled ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <ShieldBan className="h-4 w-4" aria-hidden />}
        >
          {row.disabled ? "Enable" : "Disable"}
        </Button>
      </td>
    </tr>
  );
}
