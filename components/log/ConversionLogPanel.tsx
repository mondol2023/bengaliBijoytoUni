"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, AlertTriangle, ChevronDown, ScrollText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConversionLog } from "@/hooks/useConversionLog";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { motionTokens, springs } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";
import type { ConversionLogEvent, LogEventKind, LogSource } from "@/lib/log/conversionLog";

/**
 * The user-facing failure log: every conversion error, failed file
 * extraction, and letter that had no mapping rule, for the whole session
 * rather than for the panel it happened in.
 *
 * It is rendered below both workspaces and reads from the module-level store,
 * so a user who hit an unmapped letter in the text converter still sees it
 * after switching to the document page.
 */

const KIND_LABELS: Record<LogEventKind, string> = {
  unmapped_character: "Unmapped letters",
  conversion_failed: "Conversion failed",
  file_extraction_failed: "File could not be read",
  validation_warning: "Output warning",
  limit_exceeded: "Limit exceeded",
  rate_limited: "Rate limited",
  unknown: "Unexpected failure",
};

const SOURCE_LABELS: Record<LogSource, string> = {
  text: "Text converter",
  file: "Document upload",
  comparison: "Comparison",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LogRow({ event }: { event: ConversionLogEvent }) {
  const isError = event.severity === "error";

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {isError ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        )}
        <span className="text-sm font-semibold">{KIND_LABELS[event.kind]}</span>
        <Badge tone={isError ? "danger" : "warning"}>{isError ? "Error" : "Warning"}</Badge>
        <Badge tone="neutral">{SOURCE_LABELS[event.source]}</Badge>
        {event.encodingId && <Badge tone="neutral">{event.encodingId}</Badge>}
        {event.occurrences > 1 && <Badge tone="accent">×{event.occurrences}</Badge>}
        <span className="ml-auto shrink-0 font-mono text-xs text-foreground/50">
          {formatTime(event.lastSeenAt)}
        </span>
      </div>

      <p className="text-sm text-foreground/80">{event.message}</p>

      {event.fileName && (
        <p className="text-xs text-foreground/60">
          File: <span className="font-mono">{event.fileName}</span>
          {event.fileType ? ` (${event.fileType})` : ""}
        </p>
      )}

      {event.samples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-foreground/60">Offending sequences:</span>
          {event.samples.map((sample) => (
            <code
              key={sample}
              className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs"
            >
              {sample}
            </code>
          ))}
        </div>
      )}

      <p className="font-mono text-[11px] text-foreground/40">{event.code}</p>
    </li>
  );
}

export function ConversionLogPanel({ className }: { className?: string }) {
  const { events, summary, clear } = useConversionLog();
  const reducedMotion = usePrefersReducedMotion();
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section
      aria-labelledby="conversion-log-heading"
      className={cn("flex flex-col rounded-lg border border-border bg-surface", className)}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <ScrollText className="h-4 w-4 shrink-0 text-foreground/60" aria-hidden />
        <h2 id="conversion-log-heading" className="text-sm font-semibold">
          Conversion log
        </h2>
        {summary.errors > 0 && <Badge tone="danger">{summary.errors} error{summary.errors === 1 ? "" : "s"}</Badge>}
        {summary.warnings > 0 && (
          <Badge tone="warning">
            {summary.warnings} warning{summary.warnings === 1 ? "" : "s"}
          </Badge>
        )}
        {events.length === 0 && <Badge tone="success">All clear</Badge>}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={events.length === 0}
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-controls="conversion-log-body"
          >
            {isOpen ? "Hide" : "Show"}
            <motion.span
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={reducedMotion ? { duration: 0 } : springs.snappy}
              className="inline-flex"
            >
              <ChevronDown className="h-4 w-4" aria-hidden />
            </motion.span>
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="log-body"
            id="conversion-log-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: motionTokens.duration.fast, ease: motionTokens.easing.standard }
            }
            className="overflow-hidden"
          >
            {events.length === 0 ? (
              <p className="px-4 py-6 text-sm text-foreground/50">
                Nothing has failed yet this session. Any conversion error, unreadable file, or Bengali
                letter without a mapping rule will be listed here.
              </p>
            ) : (
              <>
                {summary.unmappedSamples.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-muted px-4 py-2">
                    <span className="text-xs font-medium text-foreground/70">
                      Letters that failed to convert:
                    </span>
                    {summary.unmappedSamples.map((sample) => (
                      <code
                        key={sample}
                        className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs"
                      >
                        {sample}
                      </code>
                    ))}
                  </div>
                )}
                <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                  {events.map((event) => (
                    <LogRow key={event.id} event={event} />
                  ))}
                </ul>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
