"use client";

import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { ArrowUp } from "lucide-react";
import { motionTokens } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/** Scroll depth, in viewport heights, past which the control appears. */
const SHOW_AFTER_VIEWPORTS = 0.75;

const RING_RADIUS = 20;

/**
 * A floating way back to the top of whatever page the visitor is on.
 *
 * It stays out of sight until they have scrolled most of a screen — on a short
 * page it never appears, because there is nothing to go back from. A terracotta
 * arc around the arrow fills as the page is read, so the same control also
 * answers "how far down am I?" without a second widget. Terracotta is
 * legitimate here: the arc is live state, and the control is an action.
 *
 * Floating, so it carries a radius and the one soft shadow the system allows
 * on a floating surface (the skip link's). It sits above the page and below
 * dialogs (`z-50`).
 */
export function BackToTop() {
  const reducedMotion = usePrefersReducedMotion();
  const { scrollY, scrollYProgress } = useScroll();
  const [visible, setVisible] = useState(false);

  useMotionValueEvent(scrollY, "change", (value) => {
    setVisible(value > window.innerHeight * SHOW_AFTER_VIEWPORTS);
  });

  const goToTop = () => {
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={goToTop}
          aria-label="Back to top"
          className="group fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-40 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-[0_4px_12px_-2px_color-mix(in_oklab,var(--foreground)_18%,transparent)] transition-colors hover:text-accent sm:bottom-6 sm:right-6"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: motionTokens.distance.md }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: motionTokens.distance.sm }}
          transition={{ duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }}
          whileTap={reducedMotion ? undefined : { scale: motionTokens.scale.press }}
        >
          <svg
            aria-hidden
            viewBox="0 0 44 44"
            className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
          >
            <motion.circle
              cx={22}
              cy={22}
              r={RING_RADIUS}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              style={{ pathLength: scrollYProgress }}
            />
          </svg>
          <ArrowUp aria-hidden className="h-4 w-4" strokeWidth={2} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
