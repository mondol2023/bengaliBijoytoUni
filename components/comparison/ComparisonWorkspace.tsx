"use client";

import { AnimatePresence, motion } from "motion/react";
import { RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { TierSelector } from "@/components/converter/TierSelector";
import { ComparisonInputPanel } from "./ComparisonInputPanel";
import { ComparisonStats } from "./ComparisonStats";
import { DiffViewer } from "./DiffViewer";
import { SaveToHistoryButton } from "@/components/history/SaveToHistoryButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { useComparison } from "@/hooks/useComparison";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { SAMPLE_SOURCE, SAMPLE_TARGET } from "@/features/comparison/sampleText";
import type { DiffMode } from "@/features/comparison/engine/diffEngine";
import { motionTokens, springs, staggerChildren, staggerDelayChildren } from "@/lib/motion/tokens";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren, delayChildren: staggerDelayChildren },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: motionTokens.distance.md },
  visible: { opacity: 1, y: 0, transition: springs.gentle },
};

const UNREACHABLE_ERROR: SafeErrorResponse = {
  code: "UNKNOWN_ERROR",
  message: "Could not reach the server — check your connection and try again.",
};

export function ComparisonWorkspace() {
  const reducedMotion = usePrefersReducedMotion();
  const { user, getIdToken } = useAuth();
  const {
    source,
    target,
    diffMode,
    setDiffMode,
    tier,
    setTier,
    sourceUsage,
    targetUsage,
    isPending,
    result,
    clear,
  } = useComparison();

  function loadSample() {
    source.setMode("text");
    target.setMode("text");
    source.setText(SAMPLE_SOURCE);
    target.setText(SAMPLE_TARGET);
  }

  /**
   * Explicit "save to history" — the diff above already ran entirely
   * client-side (unchanged since Phase 4/5); this only persists the record
   * afterward, at the user's request, via `/api/comparisons`.
   */
  async function saveToHistory(): Promise<SafeErrorResponse | null> {
    if (!result) return UNREACHABLE_ERROR;
    const idToken = await getIdToken();
    if (!idToken) return UNREACHABLE_ERROR;
    try {
      const response = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          mode: result.mode,
          similarity: result.similarity,
          sourceWordCount: result.statistics.sourceWords,
          targetWordCount: result.statistics.targetWords,
          changedWordCount: result.statistics.changedWords,
        }),
      });
      const payload = (await response.json()) as { ok: true } | { ok: false; error: SafeErrorResponse };
      return payload.ok ? null : payload.error;
    } catch {
      return UNREACHABLE_ERROR;
    }
  }

  const hasAnyInput =
    source.text.length > 0 || target.text.length > 0 || Boolean(source.file) || Boolean(target.file);
  const overLimit = !sourceUsage.withinLimit || !targetUsage.withinLimit;

  return (
    <motion.main
      id="main"
      tabIndex={-1}
      variants={containerVariants}
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 outline-none sm:px-6 sm:py-12"
    >
      <motion.div variants={itemVariants} className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare Documents</h1>
        <p className="max-w-2xl text-sm text-foreground/70 sm:text-base">
          Paste or upload two versions of a text — legacy-encoded or Unicode — and see exactly what
          changed, word by word or paragraph by paragraph.
        </p>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground/70">Compare by</span>
          <Tabs value={diffMode} onValueChange={(value) => setDiffMode(value as DiffMode)}>
            <TabsList>
              <TabsTrigger value="word">Word</TabsTrigger>
              <TabsTrigger value="paragraph">Paragraph</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <TierSelector tier={tier} onChange={setTier} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={loadSample}
          leftIcon={<Sparkles className="h-4 w-4" aria-hidden />}
        >
          Load example
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={!hasAnyInput}
          leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
        >
          Clear
        </Button>
        {isPending && <span className="text-xs text-foreground/50">Comparing…</span>}
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-4 lg:grid-cols-2">
        <ComparisonInputPanel label="Source" side={source} usage={sourceUsage} />
        <ComparisonInputPanel label="Target" side={target} usage={targetUsage} />
      </motion.div>

      <AnimatePresence mode="wait">
        {result ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: motionTokens.distance.sm }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: motionTokens.distance.sm }}
            transition={springs.gentle}
            className="flex flex-col gap-4"
          >
            <ComparisonStats result={result} />
            {user && (
              <div>
                <SaveToHistoryButton key={`${result.mode}-${result.similarity}`} onSave={saveToHistory} />
              </div>
            )}
            <div className="rounded-lg border border-border bg-surface">
              <DiffViewer result={result} />
            </div>
          </motion.div>
        ) : (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast }}
            className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-foreground/50"
          >
            {!hasAnyInput
              ? "Add text or a file on both sides to see a comparison."
              : overLimit
                ? "One side exceeds the selected tier's limit — reduce the input or switch tiers."
                : "Add text or a file on both sides to see a comparison."}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.main>
  );
}
