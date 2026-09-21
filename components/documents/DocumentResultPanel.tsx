"use client";

import { Download, Info } from "lucide-react";
import { CopyButton } from "@/components/converter/CopyButton";
import { ConversionWarnings } from "@/components/converter/ConversionWarnings";
import { UsageMeter } from "@/components/converter/UsageMeter";
import { Button } from "@/components/ui/Button";
import type { DocumentConversionResult } from "@/hooks/useDocumentConversion";
import { downloadTextFile } from "@/lib/utils/download";

export function DocumentResultPanel({ result }: { result: DocumentConversionResult }) {
  const downloadName = result.fileName.replace(/\.[^./]+$/, "") + ".unicode.txt";

  return (
    <div className="flex flex-col gap-4">
      <UsageMeter usage={result.usage} />

      <div className="flex flex-col rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Unicode output</span>
            <span className="text-xs text-foreground/60">
              {result.fileName}
              {typeof result.pageCount === "number" ? ` · ${result.pageCount} page(s)` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={result.unicodeText} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadTextFile(downloadName, result.unicodeText)}
              leftIcon={<Download className="h-4 w-4" aria-hidden />}
            >
              Download
            </Button>
          </div>
        </div>

        {/* Read-only converted output, not an editable field — see the same
            correction in `ConverterWorkspace`. `lang="bn"` so a screen reader
            reads Bengali with a Bengali voice. */}
        <div
          role="region"
          aria-label="Converted Unicode output"
          lang="bn"
          className="font-bengali min-h-48 flex-1 whitespace-pre-wrap break-words p-4 text-base leading-relaxed"
        >
          {result.unicodeText}
        </div>

        <ConversionWarnings validation={result.validation} />

        {result.notes && result.notes.length > 0 && (
          <div className="mx-4 mb-4 flex items-start gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-foreground/70">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="flex flex-col gap-1">
              {result.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
