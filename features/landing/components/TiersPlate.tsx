"use client";

import { motion, type Variants } from "motion/react";
import { DEFAULT_TIER, listTiers } from "@/features/usage/tierConfig";
import { motionTokens, staggerChildren } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { PlateHead } from "./PlateHead";

const TIERS = listTiers();
const CEILING = Math.max(...TIERS.map((tier) => tier.maxNonWhitespaceChars));

/** What each cap means in the unit people actually think in. */
const IN_PRACTICE: Record<string, string> = {
  easy: "A letter, a form, a page or two of a report.",
  medium: "A chapter, a long article, a short contract.",
  pro: "A long report or a whole manuscript section.",
  expert: "A full document in one pass, without splitting it.",
  ultra: "A book-length manuscript in a single conversion.",
};

const row: Variants = {
  hidden: { opacity: 0, y: motionTokens.distance.md },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.slow, ease: motionTokens.easing.expoOut },
  },
};

export function TiersPlate() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <section aria-labelledby="tiers-heading" className="plate">
      <PlateHead
        headingId="tiers-heading"
        marker="Plate 05"
        heading="Five limits. All five free."
        standfirst="The only thing a tier changes is how much text one conversion may carry, counted in non-whitespace characters. There is no paid plan, no trial and no card — new accounts start on Easy, and an administrator can raise it."
      />

      <motion.ul
        initial={reducedMotion ? undefined : "hidden"}
        whileInView={reducedMotion ? undefined : "shown"}
        viewport={{ once: true, amount: 0.2 }}
        variants={{ hidden: {}, shown: { transition: { staggerChildren } } }}
        className="mt-2"
      >
        {TIERS.map((tier) => {
          const share = tier.maxNonWhitespaceChars / CEILING;
          return (
            <motion.li
              key={tier.id}
              variants={reducedMotion ? undefined : row}
              className="rule-row py-7"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h3 className="text-xl font-medium tracking-tight">
                  {tier.label}
                  {tier.id === DEFAULT_TIER ? (
                    <span className="plate-marker ml-3 inline">Default</span>
                  ) : null}
                </h3>
                <p className="font-mono text-2xl tabular-nums sm:text-3xl">
                  {tier.maxNonWhitespaceChars.toLocaleString("en-US")}
                  <span className="plate-marker ml-2 inline">chars</span>
                </p>
              </div>

              {/* The caps to scale against each other — the gap between Easy
                  and Expert is the whole point, and a number alone hides it. */}
              <span
                aria-hidden
                className="mt-4 block h-px w-full origin-left bg-border"
              >
                <motion.span
                  className="block h-px origin-left bg-accent"
                  style={{ width: `${share * 100}%` }}
                  initial={reducedMotion ? false : { scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true, amount: 0.8 }}
                  transition={{
                    duration: motionTokens.duration.deliberate,
                    ease: motionTokens.easing.expoOut,
                  }}
                />
              </span>

              <p className="mt-4 max-w-[68ch] text-sm leading-relaxed text-foreground/75">
                {IN_PRACTICE[tier.id]}
              </p>
            </motion.li>
          );
        })}
      </motion.ul>

      <p className="mt-8 max-w-[68ch] text-sm leading-relaxed text-foreground/70">
        Uploads are capped separately at 15&nbsp;MB per file, and conversions are rate limited so
        one visitor cannot starve the rest.
      </p>
    </section>
  );
}
