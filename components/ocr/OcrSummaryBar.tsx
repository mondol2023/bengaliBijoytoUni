"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { GitCompareArrows } from "lucide-react";
import { CopyButton } from "@/components/converter/CopyButton";
import { MicroButton } from "@/components/ui/MicroButton";
import { browserPrefillStorage, stashComparePrefill } from "@/features/comparison/prefill";
import type { OcrJobState } from "@/features/ocr/job/jobState";
import { combineText, ocrDownloadName } from "@/features/ocr/job/view";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { motionTokens } from "@/lib/motion/tokens";
import { downloadTextFile } from "@/lib/utils/download";

/**
 * The finished sheet's controls. The one filled button on the page once there is something to take.
 * Renders nothing until at least one line has been read.
 */
export function OcrSummaryBar({
  state,
  fileName,
  onReadAgain,
}: {
  state: OcrJobState;
  fileName: string;
  onReadAgain: () => void;
}) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const [handOffFailed, setHandOffFailed] = useState(false);

  if (state.phase !== "done" && state.phase !== "cancelled") return null;
  const text = combineText(state.items, state.outcomes, state.improvements);
  if (text === "") return null;

  function openInCompare() {
    if (!stashComparePrefill(browserPrefillStorage(), text, Date.now())) {
      setHandOffFailed(true);
      return;
    }
    setHandOffFailed(false);
    router.push("/compare");
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4">
      <MicroButton onClick={onReadAgain}>Read again</MicroButton>
      <MicroButton onClick={() => downloadTextFile(ocrDownloadName(fileName), text)}>Download .txt</MicroButton>
      <MicroButton onClick={openInCompare} icon={<GitCompareArrows className="h-3.5 w-3.5" aria-hidden />}>
        Open in Compare
      </MicroButton>
      <CopyButton text={text} variant="primary" label="Copy all" />
      <AnimatePresence>
        {handOffFailed && (
          <motion.span
            role="alert"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.standard }}
            className="basis-full pt-1 text-xs text-warning"
          >
            Couldn&apos;t hand this to Compare (too long for the browser to carry over). Copy it and paste it there.
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
