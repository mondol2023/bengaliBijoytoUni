"use client";

import { useId, useMemo } from "react";
import { motion } from "motion/react";
import { Sparkles, Trash2, Download, AlertCircle } from "lucide-react";
import { MicroButton } from "@/components/ui/MicroButton";
import { ReadoutStrip } from "@/components/ui/ReadoutStrip";
import { ToolHead } from "@/components/layout/ToolHead";
import { PrivacyNote } from "@/components/privacy/PrivacyNote";
import { CONVERTER_NOTE } from "@/lib/privacy/disclosure";
import { EncodingSelector } from "./EncodingSelector";
import { TierSelector } from "./TierSelector";
import { UsageMeter } from "./UsageMeter";
import { ConversionWarnings } from "./ConversionWarnings";
import { ConversionOutputText, FallbackSummary } from "./ConversionOutputText";
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
import { AUTO_DETECT } from "@/features/converter/constants";
import { conversionUsageRecord } from "@/features/usage/conversionUsage";
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
    fallback,
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
    { source: "text", encodingId: resolvedEncodingId ?? null },
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
        body: JSON.stringify(
          conversionUsageRecord({ encodingId: resolvedEncodingId, usage, wordCount }),
        ),
      });
      const payload = (await response.json()) as { ok: true } | { ok: false; error: SafeErrorResponse };
      return payload.ok ? null : payload.error;
    } catch {
      return UNREACHABLE_ERROR;
    }
  }

  const resolvedEncoding = encodings.find((encoding) => encoding.id === resolvedEncodingId);
  const unmappedCount = output?.validation?.unmappedSequences.length ?? 0;
  const hasInput = inputText.trim().length > 0;
  const statusMarker = !hasInput
    ? "Waiting for text"
    : resolvedEncoding
      ? `${resolvedEncoding.name} · ${encodingChoice === AUTO_DETECT ? "detected" : "chosen"}`
      : "No confident match";

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
          title="Text converter"
          marker={statusMarker}
          standfirst="Paste Bijoy or SutonnyMJ text that shows up as gibberish. It is re-set as standard Unicode as you type, and anything without a mapping rule is counted rather than guessed."
        />
      </motion.div>

      {/* Settings ride on a single ruled row, not inside a box. */}
      <motion.div
        variants={itemVariants}
        className="mt-6 flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between"
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

      <motion.div variants={itemVariants} className="mt-4">
        <UsageMeter usage={usage} />
      </motion.div>

      {/* One pulled sheet split by a hairline: the legacy galley on the left,
          the proof on the right, the read-out row across both. */}
      <motion.section variants={itemVariants} aria-label="Conversion" className="sheet mt-6">
        <div className="grid lg:grid-cols-2">
          <div className="flex min-w-0 flex-col">
            <div className="sheet-band">
              <label htmlFor={inputId} className="plate-marker">
                Legacy text
              </label>
              <div className="flex items-center gap-4">
                <MicroButton onClick={loadSample} icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}>
                  Load sample
                </MicroButton>
                <MicroButton
                  onClick={clear}
                  disabled={inputText.length === 0}
                  icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                >
                  Clear
                </MicroButton>
              </div>
            </div>
            <textarea
              id={inputId}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Paste your broken text here…"
              spellCheck={false}
              className="min-h-64 flex-1 resize-y bg-transparent p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-foreground/60 focus-visible:bg-surface-muted"
            />
            <div className="sheet-foot">
              <span className="plate-marker">{wordCount.toLocaleString()} words</span>
              <span className="plate-marker">{usage.used.toLocaleString()} characters</span>
            </div>
          </div>

          <div className="flex min-w-0 flex-col border-t border-border lg:border-l lg:border-t-0">
            <div className="sheet-band">
              {/* Not a <label htmlFor>: the output is a <div>, which is not a
                  labelable element. A heading referenced by aria-labelledby
                  names the region for assistive tech. */}
              <h2 id={outputLabelId} className="plate-marker">
                Unicode
              </h2>
              <div className="flex items-center gap-4">
                {user && (
                  <SaveToHistoryButton
                    key={output?.unicodeText ?? ""}
                    onSave={saveToHistory}
                    disabled={!output?.unicodeText}
                  />
                )}
                <MicroButton
                  disabled={!output?.unicodeText}
                  onClick={() => downloadTextFile("converted.txt", output?.unicodeText ?? "")}
                  icon={<Download className="h-3.5 w-3.5" aria-hidden />}
                >
                  Download
                </MicroButton>
                <CopyButton variant="primary" text={output?.unicodeText ?? ""} />
              </div>
            </div>
            {/* A live region, not role="textbox": read-only output that
                updates as you type. `lang` goes on the Bengali itself (inside
                ConversionOutputText), not on the panel, which also holds
                English placeholder and error copy. */}
            <div
              id={outputId}
              role="region"
              aria-labelledby={outputLabelId}
              aria-live="polite"
              className="min-h-64 flex-1 whitespace-pre-wrap break-words p-4 font-bengali text-xl leading-relaxed"
            >
              {isOverLimit ? (
                <span className="font-sans text-sm text-danger">
                  Over the {usage.tier} limit — shorten the text or choose a higher limit to see the
                  converted output.
                </span>
              ) : error ? (
                <span className="inline-flex items-start gap-2 font-sans text-sm text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {error.message}
                </span>
              ) : output?.unicodeText ? (
                <ConversionOutputText text={output.unicodeText} fallback={fallback} />
              ) : (
                <span className="font-sans text-sm text-foreground/60">Converted Bengali appears here.</span>
              )}
            </div>
            <ConversionWarnings validation={output?.validation ?? null} />
            {fallback && resolvedEncodingId && (
              <FallbackSummary fallback={fallback} encodingId={resolvedEncodingId} wordCount={wordCount} />
            )}
          </div>
        </div>

        <ReadoutStrip
          className="border-t border-border"
          readouts={[
            { label: "Encoding", value: hasInput ? (resolvedEncoding?.name ?? "—") : "—" },
            {
              label: encodingChoice === AUTO_DETECT ? "Detected" : "Chosen",
              value:
                hasInput && resolvedEncoding
                  ? encodingChoice === AUTO_DETECT
                    ? `${Math.round(detectionConfidence * 100)}%`
                    : "Manual"
                  : "—",
            },
            { label: "Characters", value: usage.used.toLocaleString() },
            {
              label: "Unmapped",
              value: hasInput ? String(unmappedCount) : "—",
              tone: unmappedCount > 0 ? "warning" : "ok",
            },
          ]}
        />
      </motion.section>

      {/* Directly under the input's sheet: the moment before someone pastes
          is the only moment this line can change what they paste. */}
      <motion.div variants={itemVariants}>
        <PrivacyNote note={CONVERTER_NOTE} className="mt-3 max-w-[68ch]" />
      </motion.div>

      <motion.div variants={itemVariants} className="mt-12">
        <ConversionLogPanel />
      </motion.div>

      <motion.div variants={itemVariants} className="mt-6">
        <FeedbackForm
          encodingId={resolvedEncodingId ?? null}
          sampleInput={inputText || null}
          sampleOutput={output?.unicodeText ?? null}
        />
      </motion.div>
    </motion.main>
  );
}
