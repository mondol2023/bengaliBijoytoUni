"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { motionTokens } from "@/lib/motion/tokens";
import type { ValidationResult } from "@/features/converter/engine/pipeline";

export function ConversionWarnings({ validation }: { validation: ValidationResult | null }) {
  const show = Boolean(validation && !validation.valid);

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
          <div className="mx-4 mb-4 mt-1 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="flex flex-col gap-1">
              {validation.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
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
