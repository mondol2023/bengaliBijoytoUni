"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SideSpelling } from "@/features/comparison/spelling/types";
import type { SpellcheckStatus } from "@/hooks/useSpellcheck";
import { cn } from "@/lib/utils/cn";

/** More than this per side is a wall; the count above it says how many were left out. */
const MAX_LISTED_WORDS = 40;

function SideList({
  label,
  side,
  suggestions,
  className,
}: {
  label: string;
  side: SideSpelling;
  suggestions: Record<string, string[]>;
  className?: string;
}) {
  const listed = side.words.slice(0, MAX_LISTED_WORDS);
  const hidden = side.words.length - listed.length;

  return (
    <div className={cn("min-w-0 px-4 py-4 sm:px-6", className)}>
      <h3 className="plate-marker">{label}</h3>

      {side.skipped ? (
        <p className="mt-2 max-w-[60ch] text-sm text-foreground/70">
          Not checked — this text looks like legacy-encoded Bengali (Bijoy, SutonnyMJ…), whose Latin-looking
          letters are not English words.
        </p>
      ) : listed.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-foreground/70">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          No misspelled English words found.
        </p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col gap-1.5">
            {listed.map(({ word, count }) => {
              const options = suggestions[word.toLowerCase()];
              return (
                <li key={word.toLowerCase()} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-mono text-warning underline decoration-wavy decoration-1 underline-offset-4">
                    {word}
                  </span>
                  {count > 1 && <span className="font-mono text-xs text-foreground/60">×{count}</span>}
                  {options && options.length > 0 && (
                    <span className="text-foreground/70">
                      <span aria-hidden>→</span> <span className="sr-only">did you mean </span>
                      {options.join(", ")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {hidden > 0 && (
            <p className="mt-2 font-mono text-xs text-foreground/60">+{hidden.toLocaleString()} more not listed</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The spelling findings in one place: every distinct misspelled English word
 * per side, how often, and (as they arrive) what it probably should be. The
 * diff marks the words in context; this is the list to work through.
 *
 * Renders nothing when the feature is off. Loading and failure are stated
 * plainly rather than left as an empty box.
 */
export function SpellingSummary({
  status,
  source,
  target,
  suggestions,
}: {
  status: SpellcheckStatus;
  source: SideSpelling | null;
  target: SideSpelling | null;
  suggestions: Record<string, string[]>;
}) {
  if (status === "off") return null;

  const total = (source?.misspellings.length ?? 0) + (target?.misspellings.length ?? 0);

  return (
    <section aria-label="Spelling" className="sheet mt-6">
      <div className="sheet-band">
        <span className="plate-marker">Possible misspellings · English words only</span>
        {status === "ready" && total > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {total.toLocaleString()} flagged
          </span>
        )}
      </div>

      {status === "loading" && (
        <p role="status" className="px-4 py-4 text-sm text-foreground/70 sm:px-6">
          Loading the English dictionary…
        </p>
      )}
      {status === "unavailable" && (
        <p role="status" className="px-4 py-4 text-sm text-foreground/70 sm:px-6">
          The spelling dictionary could not be loaded, so spelling was not checked. The comparison above is
          unaffected.
        </p>
      )}
      {status === "ready" && source && target && (
        <div className="grid lg:grid-cols-2">
          <SideList label="Source" side={source} suggestions={suggestions} />
          <SideList
            label="Target"
            side={target}
            suggestions={suggestions}
            className="border-t border-border lg:border-l lg:border-t-0"
          />
        </div>
      )}
    </section>
  );
}
