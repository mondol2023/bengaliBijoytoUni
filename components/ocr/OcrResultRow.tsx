"use client";

import { memo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { Dialog } from "@/components/ui/Dialog";
import type { ItemOutcome } from "@/features/ocr/engine/orchestrator";
import type { OcrItemMeta } from "@/features/ocr/job/source";
import { describeItem } from "@/features/ocr/job/view";
import { motionTokens, springs, staggerTight } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";

/** A strip wider than this many times its height gets the full width above its text. */
const WIDE_STRIP_ASPECT = 4;

function metaText(outcome: ItemOutcome, verifyNumbers: boolean): string | null {
  if (outcome.status === "unreadable") return "unreadable";
  if (outcome.status === "failed") return "failed";
  const view = describeItem(outcome);
  const parts = [view.confidenceText, outcome.lang === "ben" ? "ben" : "ben+eng", "Tesseract"];
  if (view.needsCheck) parts.push("check");
  else if (verifyNumbers) parts.push("verify numbers");
  return parts.join(" · ");
}

export const OcrResultRow = memo(function OcrResultRow({
  item,
  outcome,
  previewUrl,
  reducedMotion,
}: {
  item: OcrItemMeta;
  outcome: ItemOutcome;
  previewUrl: string | undefined;
  /** Read once by the list: a primitive, so the memo holds. */
  reducedMotion: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [resolved, setResolved] = useState(false);

  const view = outcome.status === "done" ? describeItem(outcome) : null;
  const needsCheck = view?.needsCheck ?? false;
  const meta = metaText(outcome, Boolean(view?.hasDigits && !needsCheck));

  let body: React.ReactNode;
  if (outcome.status === "failed") {
    body = <p className="text-sm text-danger">{outcome.error.message}</p>;
  } else if (outcome.status === "unreadable") {
    body = <p className="text-sm text-foreground/70">This image could not be read and was left out.</p>;
  } else if (outcome.text.trim() === "") {
    body = <p className="text-sm text-foreground/70">No text found in this image.</p>;
  } else {
    const textClass = cn(
      "whitespace-pre-wrap break-words leading-relaxed",
      view?.lang === "bn" ? "font-bengali text-xl" : "text-base",
    );
    // Once resolved, a plain element: motion would otherwise leave `filter: blur(0px)` (a stacking context) on every row.
    body =
      resolved || reducedMotion ? (
        <p lang={view?.lang} className={textClass}>
          {outcome.text}
        </p>
      ) : (
        <motion.p
          lang={view?.lang}
          initial={{ opacity: 0, filter: `blur(${motionTokens.blur.md}px)`, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          onAnimationComplete={() => setResolved(true)}
          transition={{
            duration: motionTokens.duration.slow,
            ease: motionTokens.easing.expoOut,
            delay: staggerTight * 3,
          }}
          className={textClass}
        >
          {outcome.text}
        </motion.p>
      );
  }

  return (
    <motion.li
      initial={reducedMotion ? false : { opacity: 0, x: -motionTokens.distance.md }}
      animate={{ opacity: 1, x: 0 }}
      transition={springs.gentle}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 160px" }}
      className="border-b border-border last:border-b-0"
    >
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
        <span className="plate-marker">{item.label}</span>
        {meta && <span className={cn("plate-marker text-right", needsCheck && "text-warning")}>{meta}</span>}
      </div>

      <div className={cn("px-4 py-3", wide || !previewUrl ? "flex flex-col gap-3" : "flex gap-4")}>
        {previewUrl && (
          <>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={`Enlarge the image for ${item.label}`}
              className={cn(
                "block shrink-0 self-start border border-border bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                wide ? "w-full" : "w-40",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL; next/image cannot optimise it */}
              <img
                src={previewUrl}
                alt=""
                aria-hidden="true"
                className="block h-auto w-full"
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  setWide(naturalHeight > 0 && naturalWidth / naturalHeight > WIDE_STRIP_ASPECT);
                }}
              />
            </button>
            <Dialog open={open} onOpenChange={setOpen} title={item.label} className="max-w-5xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL */}
              <img src={previewUrl} alt="" aria-hidden="true" className="max-h-[75vh] w-full object-contain" />
            </Dialog>
          </>
        )}
        <div className="min-w-0 flex-1">{body}</div>
      </div>

      {needsCheck && (
        <div className="sheet-note bg-warning/10 text-warning">
          <AlertCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span>Low confidence. Check this line against the image, especially the numbers.</span>
        </div>
      )}
    </motion.li>
  );
});
