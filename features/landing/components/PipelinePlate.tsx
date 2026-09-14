"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { motion, useInView, type Variants } from "motion/react";
import { motionTokens, staggerTight } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useSpecimen } from "../SpecimenProvider";
import type { PipelineStageId } from "../specimen";
import { PlateHead } from "./PlateHead";

/** How each station's hand-off should be set: legacy bytes, or Bengali. */
const SCRIPT: Record<PipelineStageId, "mono" | "bengali"> = {
  tokenize: "mono",
  map: "bengali",
  reorder: "bengali",
  assemble: "bengali",
  validate: "mono",
};

/** Dwell per station, in ms — long enough to read one hand-off before the next. */
const STATION_MS = motionTokens.duration.slow * 1000 + 180;

const chip: Variants = {
  idle: { opacity: 0, y: motionTokens.distance.sm, filter: `blur(${motionTokens.blur.sm}px)` },
  live: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: motionTokens.duration.normal, ease: motionTokens.easing.expoOut },
  },
};

const chipGroup: Variants = {
  idle: {},
  live: { transition: { staggerChildren: staggerTight, delayChildren: 0.06 } },
};

/**
 * The conversion, walked one station at a time. The stages are not an
 * illustration — `tracePipeline` re-runs the engine's own stage functions
 * over whatever is currently in the proof slip, so the hand-off shown under
 * each station is the actual intermediate state, down to the token count.
 */
export function PipelinePlate() {
  const { stages, isSample } = useSpecimen();
  const reducedMotion = usePrefersReducedMotion();

  const railRef = useRef<HTMLOListElement>(null);
  const inView = useInView(railRef, { once: true, amount: 0.25 });

  const total = stages.length;
  const [reached, setReached] = useState(0);
  const [runId, setRunId] = useState(0);

  const replay = useCallback(() => {
    setReached(0);
    setRunId((id) => id + 1);
  }, []);

  useEffect(() => {
    // Reduced motion has no sequence to run: every station is already
    // committed below, derived rather than set.
    if (!inView || total === 0 || reducedMotion) return;

    const timers = Array.from({ length: total }, (_, index) =>
      window.setTimeout(() => setReached(index + 1), index * STATION_MS),
    );
    return () => timers.forEach(window.clearTimeout);
    // `runId` re-arms the sequence when the visitor asks for a replay.
  }, [inView, total, reducedMotion, runId]);

  const committed = reducedMotion && inView ? total : reached;

  return (
    <section aria-labelledby="pipeline-heading" className="plate">
      <PlateHead
        headingId="pipeline-heading"
        marker="Plate 03"
        heading="Five stations between broken bytes and real Unicode."
        standfirst={
          isSample
            ? "Walked over the synthetic sample. Type into the proof slip above and these stations re-run on your own text."
            : "Walked over the text you typed above, stage by stage, by the same functions the converter calls."
        }
      />

      <div className="mt-8 flex items-center justify-between gap-4 border-b border-border pb-3">
        <span className="plate-marker">Hand-off shown under each station</span>
        <button
          type="button"
          onClick={replay}
          className="inline-flex items-center gap-2 rounded-sm font-mono text-[0.7rem] uppercase tracking-[0.12em] text-foreground/70 underline decoration-border underline-offset-4 transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Replay
        </button>
      </div>

      <ol ref={railRef} className="relative mt-2 pl-8 sm:pl-10">
        {stages.map((stage, index) => {
          const live = committed > index;
          return (
            <li key={stage.id} className="rule-row relative py-7">
              {/* The rail is drawn station to station rather than as one span
                  down the list: each segment starts at this node's centre and
                  ends at the next one's, so it stops dead on the last station
                  instead of running past it into the list's bottom padding.
                  x: node left (-32 / -40) + radius 7.5, rounded onto the pixel
                  the 1px line occupies. y: top-[34px] + radius. */}
              {index < total - 1 ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-[-25px] top-[41px] block h-full w-px bg-border sm:left-[-33px]"
                >
                  <motion.span
                    className="absolute inset-0 block origin-top bg-accent"
                    initial={false}
                    animate={{ scaleY: committed > index + 1 ? 1 : 0 }}
                    transition={{
                      duration: reducedMotion ? 0 : motionTokens.duration.slow,
                      ease: motionTokens.easing.smooth,
                    }}
                  />
                </span>
              ) : null}

              <span
                aria-hidden
                className={`absolute left-[-32px] top-[34px] block h-[15px] w-[15px] rounded-full border transition-colors duration-300 sm:left-[-40px] ${
                  live ? "border-accent bg-accent" : "border-border bg-background"
                }`}
              />

              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h3 className="text-base font-medium tracking-tight">
                  <span className="plate-marker mr-3 inline">{`0${index + 1}`}</span>
                  {stage.label}
                </h3>
                <motion.span
                  className={`plate-marker ${live ? "text-accent" : ""}`}
                  initial={false}
                  animate={{ opacity: live ? 1 : 0.35 }}
                  transition={{ duration: motionTokens.duration.normal }}
                >
                  {stage.readout}
                </motion.span>
              </div>

              <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-foreground/75">
                {stage.note}
              </p>

              <motion.div
                variants={chipGroup}
                initial="idle"
                animate={live ? "live" : "idle"}
                className="mt-3 flex flex-wrap gap-1.5"
              >
                {stage.preview.map((piece, pieceIndex) => (
                  <motion.span
                    key={`${stage.id}-${pieceIndex}-${piece}`}
                    variants={reducedMotion ? undefined : chip}
                    lang={SCRIPT[stage.id] === "bengali" ? "bn" : undefined}
                    className={`inline-block border border-border bg-surface px-2 py-1 text-sm leading-snug ${
                      SCRIPT[stage.id] === "bengali"
                        ? "font-bengali"
                        : "font-mono text-xs tracking-tight"
                    }`}
                  >
                    {piece}
                  </motion.span>
                ))}
              </motion.div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
