"use client";

import { RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/Button";
import { StatCard } from "./StatCard";
import { useAdminOverview } from "@/hooks/useAdminOverview";
import { listTiers } from "@/features/usage/tierConfig";
import { listEncodings } from "@/features/converter/encodings/registry";

const SERIES_COLORS = {
  conversions: "var(--accent)",
  comparisons: "var(--success)",
  documents: "var(--warning)",
  errors: "var(--danger)",
};

const PIE_COLORS = ["var(--accent)", "var(--success)", "var(--warning)", "var(--danger)"];

function formatDay(date: string): string {
  const parts = date.split("-");
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : date;
}

/** Recharts' `labelFormatter` hands back whatever the axis data key held — always a `date` string here. */
function formatDayLabel(label: React.ReactNode): React.ReactNode {
  return typeof label === "string" ? formatDay(label) : label;
}

export function AdminOverview() {
  const { totals, daily, isLoading, error, refresh } = useAdminOverview();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
        <Button variant="ghost" size="sm" onClick={refresh} loading={isLoading} leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}>
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!isLoading && totals && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total users" value={totals.totalUsers.toLocaleString()} />
            <StatCard
              label="Conversions"
              value={totals.totalConversions.toLocaleString()}
              hint={`${totals.conversionsByStatus.error.toLocaleString()} failed`}
            />
            <StatCard label="Comparisons" value={totals.totalComparisons.toLocaleString()} />
            <StatCard
              label="Documents"
              value={totals.totalDocuments.toLocaleString()}
              hint={`${totals.documentsByStatus.error.toLocaleString()} failed`}
            />
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground/80">Activity over the last 30 days</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fontSize: 11 }} stroke="var(--border)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--border)" allowDecimals={false} />
                  <RechartsTooltip labelFormatter={formatDayLabel} />
                  <Legend />
                  <Line type="monotone" dataKey="conversions" name="Conversions" stroke={SERIES_COLORS.conversions} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="comparisons" name="Comparisons" stroke={SERIES_COLORS.comparisons} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="documents" name="Documents" stroke={SERIES_COLORS.documents} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground/80">Error trend</h3>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fontSize: 11 }} stroke="var(--border)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--border)" allowDecimals={false} />
                    <RechartsTooltip labelFormatter={formatDayLabel} />
                    <Legend />
                    <Bar dataKey="conversionErrors" name="Conversion errors" fill={SERIES_COLORS.errors} />
                    <Bar dataKey="documentErrors" name="Document errors" fill={SERIES_COLORS.documents} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground/80">Users by tier</h3>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={listTiers().map((tier) => ({ name: tier.label, value: totals.usersByTier[tier.id] }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={40}
                      outerRadius={70}
                    >
                      {listTiers().map((tier, index) => (
                        <Cell key={tier.id} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground/80">Conversions by encoding</h3>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={listEncodings().map((encoding) => ({
                      name: encoding.name,
                      value: totals.conversionsByEncoding[encoding.id] ?? 0,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--border)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--border)" allowDecimals={false} />
                    <RechartsTooltip />
                    <Bar dataKey="value" name="Conversions" fill={SERIES_COLORS.conversions} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground/80">Documents by format</h3>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(totals.documentsByFormat).map(([format, value]) => ({
                        name: format.toUpperCase(),
                        value,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={40}
                      outerRadius={70}
                    >
                      {Object.keys(totals.documentsByFormat).map((format, index) => (
                        <Cell key={format} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
