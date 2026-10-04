"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Info } from "lucide-react";
import { motionTokens } from "@/lib/motion/tokens";
import type { ValidationResult } from "@/features/converter/engine/pipeline";

/**
 * Details spelled out in the panel. The rest stay in the summary line's byte
 * list — showing forty context blocks would bury the ones that matter.
 */
const MAX_DETAILED = 8;

export function ConversionWarnings({ validation }: { validation: ValidationResult | null }) {
  /**
   * Already-Unicode input is a no-op, not a failure, so it reports
   * `valid: true` (which is what keeps it out of the logs) and still needs
   * to say something. It gets the neutral surface and an info icon rather
   * than the warning palette — nothing went wrong.
   */
  const isNotice = Boolean(validation?.alreadyUnicode);
  const show = Boolean(validation && (!validation.valid || isNotice));
  const details = validation?.unmappedDetails ?? [];
  const detailed = details.slice(0, MAX_DETAILED);

  return (
    <AnimatePresence>
      {show && validation && (
        <motion.div
          key="warnings"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.standard }}
          className="overflow-hidden"
        >
          <div
            className={
              isNotice
                ? "sheet-note bg-surface-muted text-foreground/80"
                : "sheet-note bg-warning/10 text-warning"
            }
          >
            {isNotice ? (
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <div className="flex min-w-0 flex-col gap-2">
              {validation.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}

              {details.length > 0 && (
                <div className="flex flex-col gap-2">
                  {/*
                    The bare byte list above says *what* failed; a user cannot
                    act on "Ê is unmapped". These rows say *where* — the
                    converted Bangla either side of each occurrence — which is
                    what lets someone recognise the missing conjunct and send
                    back a sample the mapping table can be fixed from.
                  */}
                  <p className="text-xs opacity-80">
                    Where each one occurred (the ⟦…⟧ marks the character that had no rule):
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {detailed.map((detail) => (
                      <li key={detail.sequence} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-xs">
                          {detail.sequence} ×{detail.count}
                        </span>
                        {detail.contexts.map((context, index) => (
                          <span
                            key={`${detail.sequence}-${index}`}
                            className="min-w-0 break-words bg-warning/10 px-1.5 py-0.5 font-bengali text-sm"
                            lang="bn"
                          >
                            {context}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                  {details.length > detailed.length && (
                    <p className="text-xs opacity-80">
                      …and {details.length - detailed.length} more unmapped sequence(s).
                    </p>
                  )}
                </div>
              )}

              {validation.unmappedSequences.length > 0 && (
                <p>
                  Unmapped sequences (kept as-is, not dropped):{" "}
                  <span className="font-mono">{validation.unmappedSequences.join(", ")}</span>
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
