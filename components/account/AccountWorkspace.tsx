"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { FileText, GitCompare, RefreshCw, Type } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAccountHistory } from "@/hooks/useAccountHistory";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { listTiers } from "@/features/usage/tierConfig";
import { motionTokens, springs, staggerChildren, staggerDelayChildren } from "@/lib/motion/tokens";
import type { TierId } from "@/types/domain";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren, delayChildren: staggerDelayChildren } },
};

const itemVariants = {
  hidden: { opacity: 0, y: motionTokens.distance.md },
  visible: { opacity: 1, y: 0, transition: springs.gentle },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AccountWorkspace() {
  const reducedMotion = usePrefersReducedMotion();
  const { isConfigured, isLoading, user, profile, isProfileLoading, setAccountTier } = useAuth();
  const { conversions, comparisons, documents, isLoading: isHistoryLoading, error, refresh } = useAccountHistory();
  const [tierError, setTierError] = useState<string | null>(null);
  const [isSavingTier, setIsSavingTier] = useState(false);

  if (!isConfigured) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-12 text-center outline-none sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-foreground/60">
          Sign-in and saved history aren&apos;t set up yet for this deployment — see docs/firebase-setup.md.
        </p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2 px-4 py-12 outline-none">
        <RefreshCw className="h-5 w-5 animate-spin text-foreground/40" aria-hidden />
      </main>
    );
  }

  if (!user) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-12 text-center outline-none sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-foreground/60">Sign in from the header to see your account and saved history.</p>
      </main>
    );
  }

  async function handleTierChange(tier: TierId) {
    setIsSavingTier(true);
    setTierError(null);
    const result = await setAccountTier(tier);
    setIsSavingTier(false);
    if (result) setTierError(result.message);
  }

  return (
    <motion.main
      id="main"
      tabIndex={-1}
      variants={containerVariants}
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 outline-none sm:px-6 sm:py-12"
    >
      <motion.div variants={itemVariants} className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Account</h1>
        <p className="text-sm text-foreground/70">{user.email}</p>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground/70">Usage tier</span>
          <p className="text-xs text-foreground/50">
            Applies to document uploads and is used for your usage limit everywhere you&apos;re signed in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isProfileLoading || !profile ? (
            <span className="text-sm text-foreground/50">Loading…</span>
          ) : (
            <Select
              value={profile.tier}
              onValueChange={(value) => void handleTierChange(value as TierId)}
              options={listTiers().map((t) => ({
                value: t.id,
                label: `${t.label} · up to ${t.maxNonWhitespaceChars.toLocaleString()} chars`,
              }))}
              ariaLabel="Account tier"
              className="min-w-56"
            />
          )}
          {isSavingTier && <RefreshCw className="h-4 w-4 animate-spin text-foreground/40" aria-hidden />}
        </div>
      </motion.div>
      {tierError && <p className="text-sm text-danger">{tierError}</p>}

      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          loading={isHistoryLoading}
          leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}
        >
          Refresh
        </Button>
      </motion.div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <motion.div variants={itemVariants} className="grid gap-4 lg:grid-cols-3">
        <HistorySection
          title="Conversions"
          icon={<Type className="h-4 w-4" aria-hidden />}
          empty="No saved conversions yet."
          items={conversions.map((record) => ({
            id: record.id,
            primary: record.encodingId,
            secondary: `${record.wordCount.toLocaleString()} words · ${record.tier}`,
            createdAt: record.createdAt,
            tone: record.status === "success" ? ("success" as const) : ("danger" as const),
            toneLabel: record.status,
          }))}
        />
        <HistorySection
          title="Comparisons"
          icon={<GitCompare className="h-4 w-4" aria-hidden />}
          empty="No saved comparisons yet."
          items={comparisons.map((record) => ({
            id: record.id,
            primary: `${Math.round(record.similarity * 100)}% similar`,
            secondary: `${record.mode} mode · ${record.changedWordCount.toLocaleString()} words changed`,
            createdAt: record.createdAt,
          }))}
        />
        <HistorySection
          title="Documents"
          icon={<FileText className="h-4 w-4" aria-hidden />}
          empty="No uploaded documents yet."
          items={documents.map((record) => ({
            id: record.id,
            primary: record.fileName,
            secondary: `${record.fileType.toUpperCase()} · ${(record.sizeBytes / 1024).toFixed(0)} KB`,
            createdAt: record.createdAt,
            tone: record.extractionStatus === "success" ? ("success" as const) : ("danger" as const),
            toneLabel: record.extractionStatus,
          }))}
        />
      </motion.div>
    </motion.main>
  );
}

interface HistoryItem {
  id: string;
  primary: string;
  secondary: string;
  createdAt: string;
  tone?: "success" | "danger";
  toneLabel?: string;
}

function HistorySection({
  title,
  icon,
  empty,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  items: HistoryItem[];
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-foreground/50">{empty}</li>
        ) : (
          items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{item.primary}</span>
                {item.tone && item.toneLabel && (
                  <Badge tone={item.tone} className="shrink-0">
                    {item.toneLabel}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-foreground/60">{item.secondary}</span>
              <span className="text-xs text-foreground/40">{formatDate(item.createdAt)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
