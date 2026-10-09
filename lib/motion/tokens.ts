/**
 * Motion design tokens. Every animation in the app imports from here instead
 * of hard-coding durations/easings/distances — keeps motion consistent and
 * gives us one place to tune feel. Follows the `motion-patterns` skill
 * contract (durations, easings, distances, scale, springs).
 */

export const motionTokens = {
  duration: {
    fast: 0.15,
    normal: 0.3,
    slow: 0.5,
    /** Illustrative, low-frequency motion only (landing specimen, pipeline stations). */
    deliberate: 0.8,
    /** Continuous background motion only (the foundry ground drift) — never a UI transition. */
    ambient: 48,
  },
  /** Fraction of the scroll distance each background layer travels — its depth. */
  parallax: {
    far: 0.18,
    near: 0.42,
  },
  easing: {
    smooth: [0.22, 1, 0.36, 1] as const,
    standard: [0.4, 0, 0.2, 1] as const,
    /** Aggressive ease-out — for a glyph snapping into legibility. */
    expoOut: [0.19, 1, 0.22, 1] as const,
    /** Constant speed — for a scan line that sweeps at a steady rate, never a UI transition. */
    linear: "linear" as const,
  },
  distance: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 32,
    xl: 64,
  },
  /** Blur radii in px, for motion that resolves rather than merely moves. */
  blur: {
    sm: 4,
    md: 10,
    lg: 18,
  },
  scale: {
    subtle: 0.98,
    pop: 1.03,
    press: 0.97,
  },
} as const;

export const springs = {
  snappy: { type: "spring", stiffness: 400, damping: 30 } as const,
  gentle: { type: "spring", stiffness: 260, damping: 26 } as const,
  bouncy: { type: "spring", stiffness: 500, damping: 20 } as const,
  /** Scroll-linked background travel: a long, soft follow that settles after the page stops. */
  glide: { stiffness: 60, damping: 20, mass: 0.8 } as const,
};

/** Stagger interval kept within the 0.05–0.10s band the skill mandates. */
export const staggerChildren = 0.08;
export const staggerDelayChildren = 0.1;
/** Bottom of the same band — for long runs (per-glyph) where 0.08 would drag. */
export const staggerTight = 0.05;
