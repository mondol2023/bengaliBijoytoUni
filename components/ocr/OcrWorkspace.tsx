"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, RotateCcw, ScanText } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { MicroButton } from "@/components/ui/MicroButton";
import { ReadoutStrip } from "@/components/ui/ReadoutStrip";
import type { Readout } from "@/components/ui/ReadoutStrip";
import { ToolHead } from "@/components/layout/ToolHead";
import { PrivacyNote } from "@/components/privacy/PrivacyNote";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useOcrJob } from "@/hooks/useOcrJob";
import type { OcrJobState } from "@/features/ocr/job/jobState";
import { combineText, jobMarker, tally } from "@/features/ocr/job/view";
import type { OcrMode } from "@/features/ocr/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { OCR_AI_NOTE, OCR_NOTE } from "@/lib/privacy/disclosure";
import { motionTokens, springs, staggerChildren, staggerDelayChildren } from "@/lib/motion/tokens";
import { OcrDropzone } from "./OcrDropzone";
import { OcrEmptyState } from "./OcrEmptyState";
import { OcrImproveToggle } from "./OcrImproveToggle";
import { OcrModeToggle } from "./OcrModeToggle";
import { OcrProgress } from "./OcrProgress";
import { OcrResultRow } from "./OcrResultRow";
import { OcrScannerBed } from "./OcrScannerBed";
import { OcrSummaryBar } from "./OcrSummaryBar";

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

/** `SiteHeader` is `sticky top-0` and `h-14` plus a 1px rule; the sticky beds sit below it. */
const SITE_HEADER_HEIGHT = "calc(3.5rem + 1px)";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readouts(state: OcrJobState): Readout[] {
  let unreadable = state.unreadable;
  for (const outcome of Object.values(state.outcomes)) {
    if (outcome.status === "unreadable") unreadable++;
  }
  // An AI-read line is no longer "to check" in the Tesseract sense, and counts as read if it has text.
  const { read, check: toCheck, ai } = tally(state);
  return [
    { label: "Lines", value: `${read}/${state.items.length}` },
    { label: "To check", value: String(toCheck), tone: toCheck > 0 ? "warning" : "ok" },
    { label: "Engine", value: ai > 0 ? `Local + AI (${ai})` : "Local" },
    { label: "Unreadable", value: String(unreadable) },
  ];
}

export function OcrWorkspace() {
  const reducedMotion = usePrefersReducedMotion();
  const {
    state,
    file,
    setFile,
    mode,
    setMode,
    fileKind,
    start,
    cancel,
    reset,
    improveAvailable,
    improveEnabled,
    setImproveEnabled,
    improveOne,
  } = useOcrJob();
  const { user, isLoading: authLoading } = useAuth();

  // The hook keeps its engine between runs, so the download notice is only true until the first read starts.
  const [engineKept, setEngineKept] = useState(false);
  if (!engineKept && state.phase === "reading") setEngineKept(true);

  const busy = state.phase === "opening" || state.phase === "preparing" || state.phase === "reading";
  const improving = state.phase === "improving";
  const improvingNow = Object.values(state.improvements).some((improvement) => improvement.status === "running");
  // Only when all three hold does a crop ever leave the browser, so only then may the note say so.
  const aiActive = Boolean(user) && improveEnabled && improveAvailable === true;
  const hasRun = state.phase !== "idle";
  const hasResults = combineText(state.items, state.outcomes, state.improvements) !== "";

  // The hook keeps old results when the file or mode changes, so a change starts from a clean sheet.
  function chooseFile(next: File | null) {
    if (hasRun) reset();
    setFile(next);
  }
  function chooseMode(next: OcrMode) {
    if (hasRun) reset();
    setMode(next);
  }

  // `start` reads the mode it was created with, so a switch-and-read waits for the new mode to land.
  const startInPagesMode = useRef(false);
  useEffect(() => {
    if (startInPagesMode.current && mode === "pages") {
      startInPagesMode.current = false;
      start();
    }
  }, [mode, start]);
  function readWholePages() {
    startInPagesMode.current = true;
    chooseMode("pages");
  }

  const rows = useMemo(
    () => state.items.flatMap((item) => (state.outcomes[item.id] ? [{ item, outcome: state.outcomes[item.id] }] : [])),
    [state.items, state.outcomes],
  );

  const modeUnavailable = fileKind === "docx" && mode === "pages";
  const bedProps = { state, mode, onCancel: cancel, fileName: file?.name };

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
          title="Text from images"
          marker={jobMarker(state)}
          standfirst="Some PDFs and Word files hold their Bengali as pictures, so there is no text to convert. This page reads those pictures in your browser and gives you the text, line by line, next to the image it came from."
        />
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="mt-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
          <OcrModeToggle mode={mode} onChange={chooseMode} fileKind={fileKind} disabled={busy} />
          <OcrImproveToggle
            checked={improveEnabled}
            onChange={setImproveEnabled}
            signedIn={Boolean(user)}
            authLoading={authLoading}
            available={improveAvailable}
            disabled={improvingNow}
          />
        </div>
        {file && (
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-foreground/60" aria-hidden />
            <span className="truncate">{file.name}</span>
            <span className="plate-marker shrink-0">
              {formatBytes(file.size)}
              {state.pages.length > 0 ? ` · ${state.pages.length} ${state.pages.length === 1 ? "page" : "pages"}` : ""}
            </span>
          </span>
        )}
      </motion.div>

      <motion.section variants={itemVariants} aria-label="Upload" className="sheet mt-6">
        <div className="p-4">
          <OcrDropzone file={file} onFileSelected={chooseFile} disabled={busy} />
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              variant={hasResults ? "secondary" : "primary"}
              onClick={start}
              disabled={!file || modeUnavailable || improving}
              loading={busy}
              leftIcon={<ScanText className="h-4 w-4" aria-hidden />}
            >
              {busy ? "Reading…" : "Read text"}
            </Button>
            {(file || hasRun) && (
              <MicroButton
                onClick={() => {
                  reset();
                  setFile(null);
                }}
                disabled={busy}
                icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
              >
                Start over
              </MicroButton>
            )}
            {!file && <span className="text-xs text-foreground/60">Choose a file to read it.</span>}
          </div>
        </div>
      </motion.section>

      {hasRun && (
        <div
          className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-12"
          style={{ "--site-header": SITE_HEADER_HEIGHT } as React.CSSProperties}
        >
          <OcrScannerBed {...bedProps} compact className="sticky top-(--site-header) z-10 lg:hidden" />
          <OcrScannerBed {...bedProps} deferImages className="hidden lg:sticky lg:top-[calc(var(--site-header)+1rem)] lg:col-span-5 lg:block" />

          <section aria-label="Text found" className="sheet lg:col-span-7">
            <div className="sheet-band">
              <span className="plate-marker">Text found</span>
              <OcrSummaryBar state={state} fileName={file?.name ?? "document"} onReadAgain={start} />
            </div>
            {(busy || improving) && <OcrProgress state={state} onCancel={cancel} className="hidden py-1 lg:block" />}
            <OcrEmptyState
              state={state}
              mode={mode}
              fileKind={fileKind}
              firstRun={!engineKept}
              onReadPages={readWholePages}
              onRetry={start}
            />
            {rows.length > 0 && (
              <ul className="list-none">
                {rows.map(({ item, outcome }) => (
                  <OcrResultRow
                    key={item.id}
                    item={item}
                    outcome={outcome}
                    previewUrl={state.previews[item.id]}
                    improvement={state.improvements[item.id]}
                    onImprove={aiActive ? improveOne : undefined}
                    reducedMotion={reducedMotion}
                  />
                ))}
              </ul>
            )}
            <ReadoutStrip readouts={readouts(state)} className="border-t border-border bg-surface-muted" />
          </section>
        </div>
      )}

      <motion.div variants={itemVariants} className="mt-6 border border-border bg-surface-muted px-4 py-3">
        <PrivacyNote note={aiActive ? OCR_AI_NOTE : OCR_NOTE} className="max-w-[80ch]" />
      </motion.div>
    </motion.main>
  );
}
