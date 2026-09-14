"use client";

import { motion, type Variants } from "motion/react";
import type { DiffSegment } from "@/features/comparison/engine/types";
import { motionTokens, staggerTight } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

const segment: Variants = {
  hidden: { opacity: 0, filter: `blur(${motionTokens.blur.sm}px)` },
  shown: {
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth },
  },
};

/**
 * Renders a diff the server already computed. The segments arrive as props
 * precisely so the `diff` package and the comparison engine stay out of the
 * landing page's client bundle — this component only knows how to set marks
 * on text, not how to find them.
 *
 * The example mixes Bengali and English deliberately, so no single `lang` is
 * right for the block: the Bengali face comes from the font stack and Latin
 * falls through to its fallback.
 */
export function DiffSpecimen({ segments }: { segments: DiffSegment[] }) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <motion.p
      initial={reducedMotion ? undefined : "hidden"}
      whileInView={reducedMotion ? undefined : "shown"}
      viewport={{ once: true, amount: 0.3 }}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: staggerTight } } }}
      className="mt-6 max-w-[70ch] whitespace-pre-wrap font-bengali text-lg leading-[1.9]"
    >
      {segments.map((piece, index) => (
        <motion.span
          key={`${index}-${piece.type}`}
          variants={reducedMotion ? undefined : segment}
          className={
            piece.type === "added"
              ? "bg-success/10 text-success underline decoration-success decoration-1 underline-offset-4"
              : piece.type === "removed"
                ? "text-danger line-through decoration-danger decoration-1"
                : ""
          }
        >
          {piece.value}
        </motion.span>
      ))}
    </motion.p>
  );
}
