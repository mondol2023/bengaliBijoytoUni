"use client";

import { useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import type { ComparisonInputMode, ComparisonSide } from "@/hooks/useComparisonSide";
import type { UsageCheck } from "@/features/usage/usageService";
import { cn } from "@/lib/utils/cn";

export function ComparisonInputPanel({
  label,
  side,
  usage,
}: {
  label: string;
  side: ComparisonSide;
  usage: UsageCheck;
}) {
  const textareaId = useId();

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <label htmlFor={textareaId} className="text-sm font-semibold">
          {label}
        </label>
        <Tabs value={side.mode} onValueChange={(value) => side.setMode(value as ComparisonInputMode)}>
          <TabsList>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="file">File</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {side.mode === "text" ? (
          <textarea
            id={textareaId}
            value={side.text}
            onChange={(event) => side.setText(event.target.value)}
            placeholder="Paste or type text here…"
            spellCheck={false}
            className="min-h-48 flex-1 resize-y bg-transparent font-mono text-sm outline-none placeholder:text-foreground/40"
          />
        ) : (
          <div className="flex flex-1 flex-col gap-3">
            <DocumentDropzone file={side.file} onFileSelected={side.selectFile} disabled={side.isExtracting} />
            {side.isExtracting && (
              <p className="flex items-center gap-2 text-sm text-foreground/60">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Extracting text…
              </p>
            )}
            {side.meta && !side.isExtracting && !side.error && (
              <p className="text-xs text-foreground/60">
                {side.text.trim().length === 0
                  ? "No extractable text found in this file."
                  : `Extracted ${side.text.length.toLocaleString()} characters`}
                {typeof side.meta.pageCount === "number" ? ` · ${side.meta.pageCount} page(s)` : ""}
              </p>
            )}
          </div>
        )}

        {side.error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{side.error.message}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-foreground/60">
        <span>
          {usage.used.toLocaleString()} / {usage.max.toLocaleString()} non-whitespace chars
        </span>
        <span className={cn(!usage.withinLimit && "font-semibold text-danger")}>
          {usage.withinLimit ? `${usage.remaining.toLocaleString()} remaining` : "Over limit"}
        </span>
      </div>
    </div>
  );
}
