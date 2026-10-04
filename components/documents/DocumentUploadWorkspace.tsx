"use client";

import { AlertCircle, RotateCcw, Sparkles, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { EncodingSelector } from "@/components/converter/EncodingSelector";
import { TierSelector } from "@/components/converter/TierSelector";
import { Button } from "@/components/ui/Button";
import { MicroButton } from "@/components/ui/MicroButton";
import { ToolHead } from "@/components/layout/ToolHead";
import { PrivacyNote } from "@/components/privacy/PrivacyNote";
import { AI_TRANSCRIPTION_NOTE, DOCUMENTS_NOTE } from "@/lib/privacy/disclosure";
import { DocumentDropzone } from "./DocumentDropzone";
import { AiTranscriptionPanel } from "./AiTranscriptionPanel";
import { DocumentResultPanel } from "./DocumentResultPanel";
import { ConversionLogPanel } from "@/components/log/ConversionLogPanel";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { listEncodings } from "@/features/converter/encodings/registry";
import { ACCEPTED_FILE_EXTENSIONS, MAX_UPLOAD_SIZE_BYTES } from "@/features/documents/config";
import { AUTO_DETECT } from "@/features/converter/constants";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDocumentConversion } from "@/hooks/useDocumentConversion";
import { useIssueLog } from "@/hooks/useIssueLog";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { motionTokens, springs, staggerChildren, staggerDelayChildren } from "@/lib/motion/tokens";

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

/** Read from the upload config, so the running head can never drift from what the server accepts. */
const FORMATS_MARKER = `${ACCEPTED_FILE_EXTENSIONS.map((ext) => ext.replace(".", "")).join(" · ")} · ${Math.round(
  MAX_UPLOAD_SIZE_BYTES / (1024 * 1024),
)} MB`;

export function DocumentUploadWorkspace() {
  const reducedMotion = usePrefersReducedMotion();
  const encodings = listEncodings();
  const { user } = useAuth();
  const {
    file,
    setFile,
    encodingChoice,
    setEncodingChoice,
    tier,
    setTier,
    isTierLocked,
    isUploading,
    result,
    error,
    convert,
    reset,
    aiStatus,
    aiResult,
    aiError,
    transcribeWithAi,
    autoAi,
    setAutoAi,
  } = useDocumentConversion();
  const isAiRunning = aiStatus === "running";

  const resolvedEncodingId = encodingChoice === AUTO_DETECT ? result?.encodingId : encodingChoice;

  /**
   * The file the failure belongs to: `result` names the file the server
   * actually processed, while a failed upload only ever has the local `file`.
   */
  useIssueLog(
    {
      source: "file",
      encodingId: resolvedEncodingId ?? null,
      fileName: result?.fileName ?? file?.name ?? null,
      fileType: result?.fileType ?? file?.type ?? null,
    },
    { error, validation: result?.validation ?? null },
  );

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
          title="Document converter"
          marker={FORMATS_MARKER}
          standfirst="Upload a Bijoy or SutonnyMJ document that shows up as gibberish. Its text comes back as standard Unicode, with a score for how much of it the mapping rules covered."
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
          detectionConfidence={result?.detectionConfidence ?? 0}
        />
        <TierSelector
          tier={tier}
          onChange={setTier}
          locked={isTierLocked}
          caption={
            user
              ? "saved to your account"
              : "signed-out uploads are capped at Easy — sign in to use a higher tier"
          }
        />
      </motion.div>

      <motion.section variants={itemVariants} aria-label="Upload" className="sheet mt-6">
        <div className="p-4">
          <DocumentDropzone file={file} onFileSelected={setFile} disabled={isUploading} />

          {/* The action sits directly under the file it acts on. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              onClick={convert}
              disabled={!file}
              loading={isUploading}
              leftIcon={<Upload className="h-4 w-4" aria-hidden />}
            >
              {isUploading ? "Converting…" : "Convert document"}
            </Button>
            <Button
              variant="secondary"
              onClick={transcribeWithAi}
              disabled={!file || isUploading}
              loading={isAiRunning}
              leftIcon={<Sparkles className="h-4 w-4" aria-hidden />}
            >
              {isAiRunning ? "Gemini is reading…" : "Convert with Gemini"}
            </Button>
            {(file || result) && (
              <MicroButton
                onClick={reset}
                disabled={isUploading || isAiRunning}
                icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
              >
                Start over
              </MicroButton>
            )}
            {!file && <span className="text-xs text-foreground/60">Choose a file to convert it.</span>}
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.standard }}
              className="overflow-hidden"
            >
              <div role="alert" className="sheet-note bg-danger/10 text-danger">
                <AlertCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                <span>{error.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The disclosures belong to the upload, so they sit on its foot
            band. The converter's line would be false here: this path really
            does send the file to a server, and a signed-in upload is kept. */}
        <div className="flex flex-col gap-3 border-t border-border bg-surface-muted px-4 py-3">
          <PrivacyNote note={DOCUMENTS_NOTE} className="max-w-[80ch]" />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoAi}
              onChange={(event) => setAutoAi(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            Use Gemini automatically when our converter scores a file below 80%
          </label>
          <PrivacyNote note={AI_TRANSCRIPTION_NOTE} className="max-w-[80ch]" />
        </div>
      </motion.section>

      {(file || aiResult) && (
        <div className="mt-6">
          <AiTranscriptionPanel
            status={aiStatus}
            result={aiResult}
            error={aiError}
            fileName={file?.name ?? "document"}
          />
        </div>
      )}

      <AnimatePresence>
        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: motionTokens.distance.sm }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: motionTokens.distance.sm }}
            transition={springs.gentle}
            className="mt-6"
          >
            <DocumentResultPanel result={result} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={itemVariants} className="mt-12">
        <ConversionLogPanel />
      </motion.div>

      <motion.div variants={itemVariants} className="mt-6">
        <FeedbackForm
          encodingId={resolvedEncodingId ?? null}
          sampleInput={result?.fileName ?? file?.name ?? null}
          sampleOutput={result?.unicodeText ?? null}
        />
      </motion.div>
    </motion.main>
  );
}
