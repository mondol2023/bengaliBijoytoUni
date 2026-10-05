"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RotateCcw, Sparkles } from "lucide-react";
import { MicroButton } from "@/components/ui/MicroButton";
import { ToolHead } from "@/components/layout/ToolHead";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { TierSelector } from "@/components/converter/TierSelector";
import { ComparisonInputPanel } from "./ComparisonInputPanel";
import { ComparisonStats } from "./ComparisonStats";
import { DiffViewer } from "./DiffViewer";
import { SpellingSummary } from "./SpellingSummary";
import { SaveToHistoryButton } from "@/components/history/SaveToHistoryButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { useComparison } from "@/hooks/useComparison";
import { useSpellcheck } from "@/hooks/useSpellcheck";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { SAMPLE_SOURCE, SAMPLE_TARGET } from "@/features/comparison/sampleText";
import type { DiffMode } from "@/features/comparison/engine/diffEngine";
import { annotateSegments } from "@/features/comparison/spelling/annotate";
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
    comparedTexts,
    clear,
  } = useComparison();
  const spelling = useSpellcheck(comparedTexts);

  // Marks must be computed from the exact texts the diff ran on (`comparedTexts`),
  // not the live input, or their offsets would drift from the segments.
  const spellingMarks = useMemo(() => {
    if (!result || !comparedTexts || !spelling.checker || !spelling.source || !spelling.target) return undefined;
    return annotateSegments(
      result,
      { text: comparedTexts.source, spelling: spelling.source },
      { text: comparedTexts.target, spelling: spelling.target },
      spelling.checker,
    );
  }, [result, comparedTexts, spelling.checker, spelling.source, spelling.target]);

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
  const statusMarker = result
    ? `${Math.round(result.similarity * 100)}% similar · ${result.mode} mode`
    : isPending
      ? "Comparing…"
      : "Waiting for two texts";

  return (
    <motion.main
      id="main"
      tabIndex={-1}
      variants={containerVariants}
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
      className="tool-plate flex flex-col outline-none"
    >
      <motion.div variants={itemVariants}>
        <ToolHead
          title="Compare two texts"
          marker={statusMarker}
          standfirst="Paste or upload two versions — legacy or Unicode — and every word that differs is marked: removed words struck through, added words underlined. English words that look misspelled get a wavy underline."
        />
      </motion.div>

      {/* Settings ride on a single ruled row, not inside a box. */}
      <motion.div
        variants={itemVariants}
        className="mt-6 flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="plate-marker">Compare by</span>
          <Tabs value={diffMode} onValueChange={(value) => setDiffMode(value as DiffMode)}>
            <TabsList aria-label="Compare by">
              <TabsTrigger value="word">Word</TabsTrigger>
              <TabsTrigger value="paragraph">Paragraph</TabsTrigger>
            </TabsList>
          </Tabs>
          <span aria-hidden className="mx-1 hidden h-4 w-px bg-border sm:block" />
          <MicroButton onClick={loadSample} icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}>
            Load example
          </MicroButton>
          <MicroButton
            onClick={clear}
            disabled={!hasAnyInput}
            icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
          >
            Clear
          </MicroButton>
          <span aria-hidden className="mx-1 hidden h-4 w-px bg-border sm:block" />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={spelling.enabled}
              onChange={(event) => spelling.setEnabled(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            Check English spelling
          </label>
        </div>
        <TierSelector tier={tier} onChange={setTier} />
      </motion.div>

      {/* One sheet, two galleys: source and target side by side, split by a hairline. */}
      <motion.section
        variants={itemVariants}
        aria-label="Texts to compare"
        className="sheet mt-6 grid lg:grid-cols-2"
      >
        <ComparisonInputPanel label="Source" side={source} usage={sourceUsage} />
        <ComparisonInputPanel
          label="Target"
          side={target}
          usage={targetUsage}
          className="border-t border-border lg:border-l lg:border-t-0"
        />
      </motion.section>

      {/* Result: the figures first, then the full diff. */}
      <AnimatePresence>
        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: motionTokens.distance.sm }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: motionTokens.distance.sm }}
            transition={springs.gentle}
          >
            <section aria-label="Comparison figures" className="sheet mt-6 [&>*]:border-t-0">
              <ComparisonStats result={result} spelling={spelling} />
            </section>
            <SpellingSummary
              status={spelling.status}
              source={spelling.source}
              target={spelling.target}
              suggestions={spelling.suggestions}
            />
            <section aria-label="Comparison result" className="sheet mt-6">
              <div className="sheet-band">
                <span className="plate-marker">
                  Removed struck · added underlined{spelling.enabled ? " · misspelled wavy" : ""}
                </span>
                {user && (
                  <SaveToHistoryButton key={`${result.mode}-${result.similarity}`} onSave={saveToHistory} />
                )}
              </div>
              <DiffViewer result={result} marks={spellingMarks} suggestions={spelling.suggestions} />
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!result && (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast }}
            className="mt-6 border-b border-border pb-4 text-sm text-foreground/70"
          >
            {isPending
              ? "Comparing…"
              : overLimit
                ? "One side is over the character limit — shorten it or choose a higher limit."
                : "Add text or a file on both sides and the differences appear here."}
          </motion.p>
        )}
      </AnimatePresence>

    </motion.main>
  );
}
