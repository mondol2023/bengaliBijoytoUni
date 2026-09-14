"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { motionTokens } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { LinkButton } from "./LinkButton";

/** Bengali for "readable again" — the whole point, set in the script itself. */
const BENGALI_LINE = "আবার পড়ার যোগ্য";

/**
 * The last plate. The Bengali line is wiped in left-to-right behind a
 * clip-path rather than faded — it should read as type being pulled off a
 * press, which is the one gesture this page has been making throughout.
 */
export function ClosingPlate() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <section aria-labelledby="closing-heading" className="plate">
      <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <span className="plate-marker">Plate 06</span>
        <span className="plate-marker">Colophon</span>
      </div>

      <div className="mt-12 overflow-hidden">
        <motion.p
          lang="bn"
          aria-hidden
          initial={reducedMotion ? false : { clipPath: "inset(0 100% 0 0)", y: 12 }}
          whileInView={{ clipPath: "inset(0 0% 0 0)", y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{
            duration: motionTokens.duration.deliberate,
            ease: motionTokens.easing.expoOut,
          }}
          className="font-bengali text-[clamp(2.75rem,9vw,7rem)] font-bold leading-[1.15] tracking-tight text-accent"
        >
          {BENGALI_LINE}
        </motion.p>
      </div>

      <h2
        id="closing-heading"
        className="mt-8 max-w-2xl text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
      >
        Readable again — on every phone, every browser, every font.
      </h2>
      <p className="mt-5 max-w-prose text-base leading-relaxed text-foreground/80">
        Bring the file that has been stuck in Bijoy since 2004. You will get standard Unicode
        back, plus an honest list of anything the tables could not place.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <LinkButton href="/documents">
          Convert a document
          <ArrowRight className="h-4 w-4" aria-hidden />
        </LinkButton>
        <LinkButton href="/converter" variant="quiet">
          Paste text instead
        </LinkButton>
      </div>
    </section>
  );
}
