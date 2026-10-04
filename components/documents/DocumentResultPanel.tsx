"use client";

import { Download, Info } from "lucide-react";
import { CopyButton } from "@/components/converter/CopyButton";
import { ConversionWarnings } from "@/components/converter/ConversionWarnings";
import { UsageMeter } from "@/components/converter/UsageMeter";
import { MicroButton } from "@/components/ui/MicroButton";
import { ReadoutStrip } from "@/components/ui/ReadoutStrip";
import { AI_FALLBACK_THRESHOLD } from "@/features/documents/quality";
import type { DocumentConversionResult } from "@/hooks/useDocumentConversion";
import { cn } from "@/lib/utils/cn";
import { downloadTextFile } from "@/lib/utils/download";

export function DocumentResultPanel({ result }: { result: DocumentConversionResult }) {
  const downloadName = result.fileName.replace(/\.[^./]+$/, "") + ".unicode.txt";

  const qualityPercent = Math.round(result.quality.score * 100);
  const isLowQuality = result.quality.score < AI_FALLBACK_THRESHOLD;
  const unmappedCount = result.validation?.unmappedSequences.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <UsageMeter usage={result.usage} />

      <section aria-label="Converted document" className="sheet flex flex-col">
        <div className="sheet-band">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="plate-marker">Unicode</span>
            <span className="truncate text-sm font-medium">{result.fileName}</span>
            <QualityLine quality={result.quality} />
          </div>
          <div className="flex items-center gap-4">
            <MicroButton
              onClick={() => downloadTextFile(downloadName, result.unicodeText)}
              icon={<Download className="h-3.5 w-3.5" aria-hidden />}
            >
              Download
            </MicroButton>
            <CopyButton variant="primary" text={result.unicodeText} />
          </div>
        </div>

        {/* Read-only converted output, not an editable field — see the same
            correction in `ConverterWorkspace`. `lang="bn"` so a screen reader
            reads Bengali with a Bengali voice. */}
        <div
          role="region"
          aria-label="Converted Unicode output"
          lang="bn"
          className="min-h-48 flex-1 whitespace-pre-wrap break-words p-4 font-bengali text-xl leading-relaxed sm:p-6"
        >
          <div className="max-w-[75ch]">{result.unicodeText}</div>
        </div>

        <ConversionWarnings validation={result.validation} />

        {result.notes && result.notes.length > 0 && (
          <div className="sheet-note bg-surface-muted text-foreground/80">
            <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden />
            <div className="flex flex-col gap-1">
              {result.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>
        )}

        <ReadoutStrip
          className="border-t border-border"
          readouts={[
            { label: "Quality", value: `${qualityPercent}%`, tone: isLowQuality ? "warning" : "ok" },
            { label: "Pages", value: typeof result.pageCount === "number" ? String(result.pageCount) : "—" },
            { label: "Characters", value: result.usage.used.toLocaleString() },
            { label: "Unmapped", value: String(unmappedCount), tone: unmappedCount > 0 ? "warning" : "ok" },
          ]}
        />
      </section>
    </div>
  );
}

function QualityLine({ quality }: { quality: DocumentConversionResult["quality"] }) {
  const percent = Math.round(quality.score * 100);
  const low = quality.score < AI_FALLBACK_THRESHOLD;
  const why = [
    quality.reasons.includes("image-pages") && `${Math.round((1 - quality.coverage) * 100)}% of pages are images`,
    quality.reasons.includes("low-mapping") && `${Math.round(quality.mapping * 100)}% of the legacy text matched a rule`,
  ].filter(Boolean);

  return (
    <span className={cn("text-xs", low ? "text-warning" : "text-foreground/60")}>
      Converter quality {percent}%{why.length > 0 ? ` — ${why.join("; ")}` : ""}
    </span>
  );
}
