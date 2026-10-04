"use client";

import { AlertCircle, AlertTriangle, Download, Loader2, Sparkles } from "lucide-react";
import { CopyButton } from "@/components/converter/CopyButton";
import { MicroButton } from "@/components/ui/MicroButton";
import type { AiStatus, AiTranscriptionResult } from "@/hooks/useDocumentConversion";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import { downloadTextFile } from "@/lib/utils/download";

/**
 * Gemini's reading of the document, shown as its own panel — never merged
 * into the engine's output, and always labelled as AI output, because a
 * fluent model can misread a name or a case number with no visible sign that
 * it did.
 */
export function AiTranscriptionPanel({
  status,
  result,
  error,
  fileName,
}: {
  status: AiStatus;
  result: AiTranscriptionResult | null;
  error: SafeErrorResponse | null;
  fileName: string;
}) {
  if (status === "idle" || (status === "unavailable" && !error)) return null;

  const downloadName = fileName.replace(/\.[^./]+$/, "") + ".gemini.txt";

  return (
    <section aria-label="Gemini transcription" className="sheet flex flex-col">
      <div className="sheet-band">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="plate-marker inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Gemini transcription · AI output
          </span>
          <span className="text-xs text-foreground/60">
            {result
              ? `${result.trigger === "auto" ? "Used automatically — our converter scored this file below 80%" : "Requested by you"} · ${result.model}`
              : "AI output — check it against the original"}
          </span>
        </div>
        {result && (
          <div className="flex items-center gap-4">
            <MicroButton
              onClick={() => downloadTextFile(downloadName, result.text)}
              icon={<Download className="h-3.5 w-3.5" aria-hidden />}
            >
              Download
            </MicroButton>
            <CopyButton text={result.text} />
          </div>
        )}
      </div>

      {status === "running" && (
        <div role="status" className="flex items-center gap-2 p-4 text-sm text-foreground/70">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Gemini is reading the document — a long judgment can take a minute or more.
        </div>
      )}

      {error && (
        <div role="alert" className="sheet-note border-t-0 bg-danger/10 text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error.message}</span>
        </div>
      )}

      {result && (
        <>
          <div className="sheet-note border-t-0 bg-surface-muted text-foreground/80">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Read by an AI model, not converted by rules. Check names, numbers, dates and case citations
              against the original before relying on it.
              {result.truncated && " Gemini stopped at its length limit, so the end of the document is missing."}
            </p>
          </div>
          <div
            role="region"
            aria-label="Gemini transcription"
            aria-live="polite"
            lang="bn"
            className="min-h-48 whitespace-pre-wrap break-words border-t border-border p-4 font-bengali text-xl leading-relaxed sm:p-6"
          >
            {result.text}
          </div>
        </>
      )}
    </section>
  );
}
