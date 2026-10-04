"use client";

import { AlertCircle, RotateCcw, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { EncodingSelector } from "@/components/converter/EncodingSelector";
import { TierSelector } from "@/components/converter/TierSelector";
import { Button } from "@/components/ui/Button";
import { PrivacyNote } from "@/components/privacy/PrivacyNote";
import { DOCUMENTS_NOTE } from "@/lib/privacy/disclosure";
import { DocumentDropzone } from "./DocumentDropzone";
import { DocumentResultPanel } from "./DocumentResultPanel";
import { ConversionLogPanel } from "@/components/log/ConversionLogPanel";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { listEncodings } from "@/features/converter/encodings/registry";
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
  } = useDocumentConversion();

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
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 outline-none sm:px-6 sm:py-12"
    >
      <motion.div variants={itemVariants} className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Document Converter</h1>
        <p className="max-w-2xl text-sm text-foreground/70 sm:text-base">
          Upload a legacy Bijoy or SutonnyMJ Bengali document — PDF, DOCX, DOC, or TXT — and convert its
          text to standards-compliant Unicode.
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

      <motion.div variants={itemVariants} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <DocumentDropzone file={file} onFileSelected={setFile} disabled={isUploading} />

        {/* The converter's line would be false here: this path really does
            send the file to a server, and a signed-in upload is kept. */}
        <PrivacyNote note={DOCUMENTS_NOTE} />

        <div className="flex items-center gap-2">
          <Button
            onClick={convert}
            disabled={!file}
            loading={isUploading}
            leftIcon={<Upload className="h-4 w-4" aria-hidden />}
          >
            {isUploading ? "Converting…" : "Convert document"}
          </Button>
          {(file || result) && (
            <Button
              variant="ghost"
              onClick={reset}
              disabled={isUploading}
              leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
            >
              Reset
            </Button>
          )}
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
              <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: motionTokens.distance.sm }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: motionTokens.distance.sm }}
            transition={springs.gentle}
          >
            <DocumentResultPanel result={result} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={itemVariants}>
        <ConversionLogPanel />
      </motion.div>

      <motion.div variants={itemVariants}>
        <FeedbackForm
          encodingId={resolvedEncodingId ?? null}
          sampleInput={result?.fileName ?? file?.name ?? null}
          sampleOutput={result?.unicodeText ?? null}
        />
      </motion.div>
    </motion.main>
  );
}
