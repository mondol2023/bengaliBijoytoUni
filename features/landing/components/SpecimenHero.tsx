"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { motionTokens, staggerChildren, staggerDelayChildren } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useSpecimen } from "../SpecimenProvider";
import { GiantSpecimen } from "./GiantSpecimen";
import { LinkButton } from "./LinkButton";
import { ProofSlip } from "./ProofSlip";

const FACTS = [
  "2 legacy encodings",
  "4 file formats",
  "3,000–25,000 characters, free",
  "Text converts in this tab",
];

/**
 * The strip re-flows 1 → 2 → 4 columns, so which edge carries a rule changes
 * with the breakpoint: a cell that leads its row must never draw a left rule,
 * and a cell that starts a new row must draw a top one. Tailwind's `first:`
 * only knows the first cell overall, which is why this is computed per index
 * against a fixed four-cell strip.
 */
function factRules(index: number): string {
  const rules = [];
  if (index > 0) rules.push("border-t");
  // Two columns: cells 2 and 4 sit inboard; cell 2 closes row one, so no top rule.
  if (index === 1) rules.push("sm:border-t-0");
  if (index % 2 === 1) rules.push("sm:border-l");
  // Four columns: one row, so every cell but the first is inboard and none is capped.
  rules.push(index > 0 ? "lg:border-l lg:border-t-0" : "lg:border-l-0");
  return rules.join(" ");
}

export function SpecimenHero() {
  const { reading, isSample } = useSpecimen();
  const reducedMotion = usePrefersReducedMotion();

  const caption = reading
    ? `${reading.encodingName} ${reading.detected ? "detected" : "selected"} · ${Math.round(
        reading.confidence * 100,
      )}% of sequences mapped${isSample ? " · synthetic sample, built to map cleanly" : ""}`
    : "Waiting for text";

  const entrance = reducedMotion
    ? undefined
    : {
        initial: { opacity: 0, y: motionTokens.distance.md },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <section aria-labelledby="hero-heading" className="plate">
      <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <span className="plate-marker">Plate 01</span>
        <span className="plate-marker">Legacy → Unicode</span>
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <GiantSpecimen headword={reading?.headword ?? ""} legacy={reading?.headwordLegacy ?? ""} />

          <p className="mt-5 border-t border-border pt-3 font-mono text-xs leading-relaxed text-foreground/70">
            {caption}
          </p>

          <motion.div
            {...entrance}
            transition={{
              duration: motionTokens.duration.slow,
              ease: motionTokens.easing.expoOut,
              delay: staggerDelayChildren,
            }}
          >
            <h1
              id="hero-heading"
              className="mt-10 max-w-xl text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl"
            >
              Bengali that renders as gibberish, re-set as real Unicode.
            </h1>
            <p className="mt-5 max-w-prose text-base leading-relaxed text-foreground/80">
              Decades of Bengali were typed in Bijoy and SutonnyMJ, where the bytes only look
              right in one font. Convert2Uni re-sets whole documents as standard Unicode — and
              tells you exactly which sequences it could not map, instead of guessing.
            </p>
          </motion.div>
        </div>

        <div className="lg:col-span-5">
          <ProofSlip />

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <LinkButton href="/documents">
              Convert a document
              <ArrowRight className="h-4 w-4" aria-hidden />
            </LinkButton>
            <LinkButton href="/converter" variant="quiet">
              Open the converter
            </LinkButton>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-foreground/70">
            No account needed. This demo is the real engine running in your browser — nothing
            you type here is uploaded.
          </p>
        </div>
      </div>

      <motion.ul
        initial={reducedMotion ? undefined : "hidden"}
        whileInView={reducedMotion ? undefined : "shown"}
        viewport={{ once: true, amount: 0.6 }}
        variants={{ hidden: {}, shown: { transition: { staggerChildren } } }}
        className="mt-14 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-4"
      >
        {FACTS.map((fact, index) => (
          <motion.li
            key={fact}
            variants={{
              hidden: { opacity: 0, y: motionTokens.distance.sm },
              shown: {
                opacity: 1,
                y: 0,
                transition: {
                  duration: motionTokens.duration.normal,
                  ease: motionTokens.easing.smooth,
                },
              },
            }}
            className={`plate-marker border-border px-1 py-4 sm:px-4 ${factRules(index)}`}
          >
            {fact}
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
