"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { motionTokens, staggerTight } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { splitGraphemes } from "../specimen";

/**
 * The page's signature moment. One word from the visitor's own text, set at
 * poster scale, with the legacy bytes it came from ghosted behind it. Every
 * re-set locks the glyphs in one cluster at a time — blurred and low at
 * first, then snapping to a crisp baseline, left to right.
 */

const word: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: staggerTight } },
  gone: { transition: { staggerChildren: staggerTight, staggerDirection: -1 } },
};

const glyph: Variants = {
  hidden: {
    opacity: 0,
    y: motionTokens.distance.md,
    filter: `blur(${motionTokens.blur.md}px)`,
  },
  shown: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: motionTokens.duration.slow, ease: motionTokens.easing.expoOut },
  },
  gone: {
    opacity: 0,
    y: -motionTokens.distance.sm,
    filter: `blur(${motionTokens.blur.sm}px)`,
    transition: { duration: motionTokens.duration.fast, ease: motionTokens.easing.standard },
  },
};

export function GiantSpecimen({ headword, legacy }: { headword: string; legacy: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const graphemes = splitGraphemes(headword);

  return (
    <div className="relative isolate min-h-[9rem] sm:min-h-[12rem] lg:min-h-[16rem]">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-2 -z-10 block select-none overflow-hidden whitespace-nowrap font-mono text-[clamp(2.5rem,7vw,5.5rem)] leading-none text-foreground opacity-[0.09]"
      >
        {legacy || " "}
      </span>

      {reducedMotion ? (
        <span
          lang="bn"
          className="block font-bengali text-[clamp(4rem,11vw,9rem)] font-bold leading-[0.95] tracking-tight"
        >
          {headword}
        </span>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={headword}
            lang="bn"
            variants={word}
            initial="hidden"
            animate="shown"
            exit="gone"
            className="flex flex-wrap font-bengali text-[clamp(4rem,11vw,9rem)] font-bold leading-[0.95] tracking-tight"
          >
            {graphemes.map((cluster, index) => (
              <motion.span key={`${cluster}-${index}`} variants={glyph} className="inline-block">
                {cluster}
              </motion.span>
            ))}
          </motion.span>
        </AnimatePresence>
      )}
    </div>
  );
}
