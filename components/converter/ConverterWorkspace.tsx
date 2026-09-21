"use client";

import { useId, useMemo } from "react";
import { motion } from "motion/react";
import { Sparkles, Trash2, Download, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EncodingSelector } from "./EncodingSelector";
import { TierSelector } from "./TierSelector";
import { UsageMeter } from "./UsageMeter";
import { ConversionWarnings } from "./ConversionWarnings";
import { CopyButton } from "./CopyButton";
import { SaveToHistoryButton } from "@/components/history/SaveToHistoryButton";
import { ConversionLogPanel } from "@/components/log/ConversionLogPanel";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { useAuth } from "@/components/auth/AuthProvider";
import { useConversion } from "@/hooks/useConversion";
import { useIssueLog } from "@/hooks/useIssueLog";
import { useConversionFailureReporter } from "@/hooks/useConversionFailureReporter";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { SAMPLE_TEXT } from "@/features/converter/sampleText";
import { downloadTextFile } from "@/lib/utils/download";
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

export function ConverterWorkspace() {
  const conversion = useConversion();
  const reducedMotion = usePrefersReducedMotion();
  const { user, getIdToken } = useAuth();
  const inputId = useId();
  const outputId = useId();
  const outputLabelId = useId();

  const {
    inputText,
    setInputText,
    settledInputText,
    encodingChoice,
    setEncodingChoice,
    tier,
    setTier,
    encodings,
    detectionConfidence,
    resolvedEncodingId,
    usage,
    isOverLimit,
    output,
    error,
    wordCount,
    clear,
  } = conversion;

  const sample = resolvedEncodingId ? SAMPLE_TEXT[resolvedEncodingId] : undefined;
  const loadSample = () => setInputText(sample ?? SAMPLE_TEXT.bijoy);

  /**
   * An over-limit input is a refusal to convert, not a conversion error, so
   * `useConversion` reports it as a flag rather than an `AppError`. The log
   * wants both kinds of failure, so give it the shape it expects.
   */
  const loggedError = useMemo<SafeErrorResponse | null>(() => {
    if (isOverLimit) {
      return {
        code: "LIMIT_EXCEEDED_ERROR",
        message: `Input is ${usage.used.toLocaleString()} characters, over the ${usage.tier} tier limit of ${usage.max.toLocaleString()} — nothing was converted.`,
      };
    }
    return error;
  }, [isOverLimit, usage.used, usage.max, usage.tier, error]);

  useIssueLog(
    { source: "text", encodingId: resolvedEncodingId ?? null },
    { error: loggedError, validation: output?.validation ?? null },
  );

  useConversionFailureReporter(
    { source: "text", encodingId: resolvedEncodingId ?? null, sourceText: settledInputText },
    output,
  );

  /**
   * Explicit "save to history" — the conversion above already ran entirely
   * client-side (unchanged since Phase 2); this only persists the record
   * afterward, at the user's request, via `/api/conversions`.
   */
  async function saveToHistory(): Promise<SafeErrorResponse | null> {
    if (!output || !resolvedEncodingId) return UNREACHABLE_ERROR;
    const idToken = await getIdToken();
    if (!idToken) return UNREACHABLE_ERROR;
    try {
      const response = await fetch("/api/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          encodingId: resolvedEncodingId,
          inputType: "text",
          charCount: usage.used,
          wordCount,
          fileFormat: null,
          durationMs: 0,
          status: "success",
          error: null,
        }),
      });
      const payload = (await response.json()) as { ok: true } | { ok: false; error: SafeErrorResponse };
      return payload.ok ? null : payload.error;
    } catch {
      return UNREACHABLE_ERROR;
    }
  }

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
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Text Converter</h1>
        <p className="max-w-2xl text-sm text-foreground/70 sm:text-base">
          Paste legacy Bijoy or SutonnyMJ Bengali text on the left. It converts to standards-compliant
          Unicode on the right as you type.
        </p>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <EncodingSelector
          encodings={encodings}
          choice={encodingChoice}
          onChange={setEncodingChoice}
          resolvedEncodingId={resolvedEncodingId}
          detectionConfidence={detectionConfidence}
        />
        <TierSelector tier={tier} onChange={setTier} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <UsageMeter usage={usage} />
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-4 lg:grid-cols-2">
        {/* Legacy input panel */}
        <div className="flex flex-col rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <label htmlFor={inputId} className="text-sm font-semibold">
              Legacy input
            </label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={loadSample} leftIcon={<Sparkles className="h-4 w-4" aria-hidden />}>
                Load sample
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                disabled={inputText.length === 0}
                leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
              >
                Clear
              </Button>
            </div>
          </div>
          <textarea
            id={inputId}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder="Paste or type legacy-encoded Bengali text here…"
            spellCheck={false}
            className="min-h-64 flex-1 resize-y bg-transparent p-4 font-mono text-sm outline-none placeholder:text-foreground/40"
          />
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-foreground/60">
            <span>{wordCount.toLocaleString()} words</span>
            <span>{usage.used.toLocaleString()} non-whitespace chars</span>
          </div>
        </div>

        {/* Unicode output panel */}
        <div className="flex flex-col rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            {/* Not a <label htmlFor>: the output is a <div>, which is not a
                labelable element, so the association silently did nothing.
                A plain heading referenced by aria-labelledby names the region
                for assistive tech and stays visible for everyone else. */}
            <h2 id={outputLabelId} className="text-sm font-semibold">
              Unicode output
            </h2>
            <div className="flex items-center gap-2">
              <CopyButton text={output?.unicodeText ?? ""} />
              <Button
                variant="ghost"
                size="sm"
                disabled={!output?.unicodeText}
                onClick={() => downloadTextFile("converted.txt", output?.unicodeText ?? "")}
                leftIcon={<Download className="h-4 w-4" aria-hidden />}
              >
                Download
              </Button>
              {user && (
                <SaveToHistoryButton
                  key={output?.unicodeText ?? ""}
                  onSave={saveToHistory}
                  disabled={!output?.unicodeText}
                />
              )}
            </div>
          </div>
          {/* `role="textbox"` was wrong twice over: it promises an editable
              field, and it was never focusable, so a screen-reader user could
              not reach it in forms mode. This is read-only output that
              updates as you type, so it is a live region instead — matching
              what the landing page's proof slip already does. `lang="bn"`
              lets a screen reader switch to a Bengali voice rather than
              reading the conversion result with an English one. */}
          <div
            id={outputId}
            role="region"
            aria-labelledby={outputLabelId}
            aria-live="polite"
            className="font-bengali min-h-64 flex-1 whitespace-pre-wrap break-words p-4 text-base leading-relaxed"
          >
            {isOverLimit ? (
              <span className="text-sm text-danger">
                Input exceeds the {usage.tier} tier limit — reduce the input or switch tiers to see
                converted output.
              </span>
            ) : error ? (
              <span className="inline-flex items-start gap-2 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error.message}
              </span>
            ) : output?.unicodeText ? (
              // `lang` goes on the Bengali itself, not the panel: the panel
              // also holds English placeholder/error copy, which a screen
              // reader would then read with a Bengali voice.
              <span lang="bn">{output.unicodeText}</span>
            ) : (
              <span className="text-sm text-foreground/40">Converted text will appear here…</span>
            )}
          </div>
          <ConversionWarnings validation={output?.validation ?? null} />
        </div>
      </motion.div>

      <motion.div variants={itemVariants}>
        <ConversionLogPanel />
      </motion.div>

      <motion.div variants={itemVariants}>
        <FeedbackForm
          encodingId={resolvedEncodingId ?? null}
          sampleInput={inputText || null}
          sampleOutput={output?.unicodeText ?? null}
        />
      </motion.div>
    </motion.main>
  );
}
