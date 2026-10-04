"use client";

import { useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import type { ComparisonInputMode, ComparisonSide } from "@/hooks/useComparisonSide";
import type { UsageCheck } from "@/features/usage/usageService";
import { cn } from "@/lib/utils/cn";

/**
 * One galley of the comparison sheet. The parent draws the frame; this half
 * only owns its head rule, its field, and its foot band.
 */
export function ComparisonInputPanel({
  label,
  side,
  usage,
  className,
}: {
  label: string;
  side: ComparisonSide;
  usage: UsageCheck;
  className?: string;
}) {
  const textareaId = useId();

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <div className="sheet-band">
        <label htmlFor={textareaId} className="plate-marker">
          {label}
        </label>
        <Tabs value={side.mode} onValueChange={(value) => side.setMode(value as ComparisonInputMode)}>
          <TabsList aria-label={`${label} input`}>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="file">File</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-1 flex-col">
        {side.mode === "text" ? (
          <textarea
            id={textareaId}
            value={side.text}
            onChange={(event) => side.setText(event.target.value)}
            placeholder="Paste or type text here…"
            spellCheck={false}
            className="min-h-48 flex-1 resize-y bg-transparent p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-foreground/60 focus-visible:bg-surface-muted"
          />
        ) : (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <DocumentDropzone file={side.file} onFileSelected={side.selectFile} disabled={side.isExtracting} />
            {side.isExtracting && (
              <p role="status" className="flex items-center gap-2 text-sm text-foreground/70">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Extracting text…
              </p>
            )}
            {side.meta && !side.isExtracting && !side.error && (
              <p className="font-mono text-xs tabular-nums text-foreground/70">
                {side.text.trim().length === 0
                  ? "No extractable text found in this file."
                  : `Extracted ${side.text.length.toLocaleString()} characters`}
                {typeof side.meta.pageCount === "number" ? ` · ${side.meta.pageCount} page(s)` : ""}
              </p>
            )}
          </div>
        )}

        {side.error && (
          <div role="alert" className="sheet-note bg-danger/10 text-danger">
            <AlertCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
            <span>{side.error.message}</span>
          </div>
        )}
      </div>

      <div className="sheet-foot">
        <span className="plate-marker">
          {usage.used.toLocaleString()} / {usage.max.toLocaleString()} characters
        </span>
        {usage.withinLimit ? (
          <span className="plate-marker">{usage.remaining.toLocaleString()} left</span>
        ) : (
          <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-danger">
            Over limit
          </span>
        )}
      </div>
    </div>
  );
}
