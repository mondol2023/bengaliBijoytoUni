"use client";

import { useMemo } from "react";
import { CopyButton } from "@/components/converter/CopyButton";
import { MicroButton } from "@/components/ui/MicroButton";
import type { OcrJobState } from "@/features/ocr/job/jobState";
import { buildLayout, layoutText } from "@/features/ocr/job/layout";
import { ocrDownloadName } from "@/features/ocr/job/view";
import { cn } from "@/lib/utils/cn";
import { downloadTextFile } from "@/lib/utils/download";

/**
 * Everything that was read, set the way the source page sets it: one sheet per page, paragraphs
 * where the page breaks them, a line per printed line, headings centred, indents kept.
 * Shown once a read has finished (or was stopped), so the layout does not reflow under the reader.
 */
export function OcrDocumentView({ state, fileName }: { state: OcrJobState; fileName: string }) {
  const settled = state.phase === "done" || state.phase === "cancelled" || state.phase === "improving";
  const pages = useMemo(
    () => (settled ? buildLayout(state.items, state.outcomes, state.improvements) : []),
    [settled, state.items, state.outcomes, state.improvements],
  );
  const text = useMemo(() => layoutText(pages), [pages]);
  if (pages.length === 0) return null;

  return (
    <section aria-label="As laid out" className="sheet mt-6">
      <div className="sheet-band">
        <span className="plate-marker">As laid out</span>
        <div className="flex flex-wrap items-center gap-x-4">
          <MicroButton
            onClick={() => downloadTextFile(ocrDownloadName(fileName).replace(/\.ocr\.txt$/, ".layout.txt"), text)}
          >
            Download .txt
          </MicroButton>
          <CopyButton text={text} label="Copy as laid out" />
        </div>
      </div>
      <p className="border-b border-border px-4 py-2 text-xs text-foreground/70">
        Lines and paragraphs follow the source page. Paragraph breaks are worked out from spacing, so check them where
        it matters.
      </p>

      <div className="flex flex-col gap-6 bg-surface-muted p-4 sm:p-6">
        {pages.map((page) => (
          <article
            key={page.key}
            aria-label={page.label}
            className="mx-auto w-full max-w-[72ch] border border-border bg-surface shadow-sm"
          >
            <header className="border-b border-border px-5 py-2">
              <span className="plate-marker">{page.label}</span>
            </header>
            <div className="flex flex-col gap-4 px-5 py-5 sm:px-8 sm:py-6">
              {page.paragraphs.map((paragraph, index) => (
                <p
                  key={`${page.key}-${index}`}
                  className={cn("break-words leading-relaxed", paragraph.align === "center" && "text-center font-medium")}
                >
                  {paragraph.lines.map((line) => (
                    <span
                      key={line.id}
                      lang={line.lang}
                      className={cn("block", line.lang === "bn" ? "font-bengali text-lg" : "text-base")}
                      style={line.indent > 0 ? { paddingInlineStart: `${(line.indent * 100).toFixed(1)}%` } : undefined}
                    >
                      {line.text}
                      {line.engine === "ai" && (
                        <span className="plate-marker ml-2 align-middle text-warning" lang="en">
                          AI
                        </span>
                      )}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
