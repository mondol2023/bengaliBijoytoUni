"use client";

import { memo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { Dialog } from "@/components/ui/Dialog";
import { MicroButton } from "@/components/ui/MicroButton";
import type { ItemOutcome } from "@/features/ocr/engine/orchestrator";
import type { ImproveState } from "@/features/ocr/fallback/improvePass";
import type { OcrItemMeta } from "@/features/ocr/job/source";
import { describeItem } from "@/features/ocr/job/view";
import type { ItemView } from "@/features/ocr/job/view";
import { motionTokens, springs, staggerTight } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";

/** A strip wider than this many times its height gets the full width above its text. */
const WIDE_STRIP_ASPECT = 4;

function metaText(outcome: ItemOutcome, view: ItemView | null, verifyNumbers: boolean): string | null {
  if (outcome.status === "unreadable") return "unreadable";
  if (outcome.status === "failed" || !view) return "failed";
  // The confidence figure is always Tesseract's, so an AI reading says so rather than borrowing it.
  if (view.engine === "ai") return `${view.confidenceText} local · AI · ${view.aiProvider}`;
  const parts = [view.confidenceText, outcome.lang === "ben" ? "ben" : "ben+eng", "Tesseract"];
  if (view.needsCheck) parts.push("check");
  else if (verifyNumbers) parts.push("verify numbers");
  return parts.join(" · ");
}

/** The same wash the scanner bed puts over a box being read. */
function ReadingWash({ reducedMotion }: { reducedMotion: boolean }) {
  return reducedMotion ? (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-accent/15" />
  ) : (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-accent/15"
      initial={{ opacity: 0.3 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: motionTokens.duration.deliberate,
        ease: motionTokens.easing.standard,
        repeat: Infinity,
        repeatType: "mirror",
      }}
    />
  );
}

export const OcrResultRow = memo(function OcrResultRow({
  item,
  outcome,
  previewUrl,
  improvement,
  onImprove,
  reducedMotion,
}: {
  item: OcrItemMeta;
  outcome: ItemOutcome;
  previewUrl: string | undefined;
  /** The AI reading laid over this line, if one was asked for. */
  improvement: ImproveState | undefined;
  /** Present only when the user may ask for AI. A stable reference, so the memo holds. */
  onImprove: ((id: string) => void) | undefined;
  /** Read once by the list: a primitive, so the memo holds. */
  reducedMotion: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  // Which readings have already played their "text resolve". Local and AI each play once, so an AI
  // reading arriving over a resolved local one animates, and flipping back and forth does not.
  const [resolvedKeys, setResolvedKeys] = useState<readonly string[]>([]);
  const [showLocal, setShowLocal] = useState(false);

  const improved = improvement?.status === "done" ? improvement : null;
  const aiShown = improved !== null && !showLocal;
  const textKey = aiShown ? "ai" : "local";
  const shownText = aiShown ? improved.text : outcome.status === "done" ? outcome.text : "";
  const view = outcome.status === "done" ? describeItem(outcome, aiShown ? improvement : undefined) : null;
  const needsCheck = view?.needsCheck ?? false;
  const running = improvement?.status === "running";
  const resolved = resolvedKeys.includes(textKey);
  const meta = metaText(outcome, view, Boolean(view?.hasDigits && !needsCheck && !aiShown));

  let body: React.ReactNode;
  if (outcome.status === "failed") {
    body = <p className="text-sm text-danger">{outcome.error.message}</p>;
  } else if (outcome.status === "unreadable") {
    body = <p className="text-sm text-foreground/70">This image could not be read and was left out.</p>;
  } else if (shownText.trim() === "") {
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
          {shownText}
        </p>
      ) : (
        <motion.p
          key={textKey}
          lang={view?.lang}
          initial={{ opacity: 0, filter: `blur(${motionTokens.blur.md}px)`, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          onAnimationComplete={() => setResolvedKeys((keys) => (keys.includes(textKey) ? keys : [...keys, textKey]))}
          transition={{
            duration: motionTokens.duration.slow,
            ease: motionTokens.easing.expoOut,
            delay: staggerTight * 3,
          }}
          className={textClass}
        >
          {shownText}
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
        <span className="plate-marker shrink-0 whitespace-nowrap">{item.label}</span>
        {meta && (
          <span className={cn("plate-marker text-right", needsCheck && "text-warning")}>
            {meta}
            {aiShown && <span className="text-warning"> · AI output</span>}
          </span>
        )}
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
        <div className="relative min-w-0 flex-1">
          {running && <ReadingWash reducedMotion={reducedMotion} />}
          {body}
          {running && <p className="mt-2 text-xs text-foreground/70">Reading again with AI…</p>}
        </div>
      </div>

      {needsCheck && (
        <div className="sheet-note bg-warning/10 text-warning">
          <AlertCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span>Low confidence. Check this line against the image, especially the numbers.</span>
          {onImprove && !running && !improved && (
            <MicroButton className="ml-auto shrink-0" onClick={() => onImprove(item.id)}>
              Improve with AI
            </MicroButton>
          )}
        </div>
      )}
      {improvement?.status === "failed" && (
        <div className="sheet-note bg-warning/10 text-warning">
          <AlertCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span>{improvement.message} The local reading is kept.</span>
        </div>
      )}
      {improved && (
        <div className="sheet-note bg-warning/10 text-warning">
          <AlertCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span>AI output. Check names and numbers against the image.</span>
          <MicroButton className="ml-auto shrink-0" onClick={() => setShowLocal((value) => !value)}>
            {showLocal ? "Show AI reading" : "Show local reading"}
          </MicroButton>
        </div>
      )}
    </motion.li>
  );
});
