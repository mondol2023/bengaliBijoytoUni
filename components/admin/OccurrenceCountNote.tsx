import { AlertTriangle } from "lucide-react";
import {
  COUNTING_CHANGE_DOC,
  COUNTING_CHANGE_NOTE,
} from "@/lib/conversionFailures/countingChange";
import { cn } from "@/lib/utils/cn";

/**
 * The warning that sits next to any rendered `occurrenceCount`.
 *
 * Visible text, not a tooltip. The reader this is for is the one glancing at
 * a total or sorting by "most frequent" and drawing a conclusion — they have
 * no reason to hover something that looks like a plain number, and a
 * keyboard or screen-reader user may not be able to. It is small and grey
 * because it should be readable without competing with the figure itself.
 *
 * Every word comes from `lib/conversionFailures/countingChange.ts`; nothing
 * here holds a string.
 */
export function OccurrenceCountNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11px] leading-snug text-warning/90",
        className,
      )}
    >
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>
        {COUNTING_CHANGE_NOTE} <span className="text-foreground/40">({COUNTING_CHANGE_DOC} §3.2.1)</span>
      </span>
    </p>
  );
}
