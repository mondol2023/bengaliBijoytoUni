"use client";

import { motion } from "motion/react";
import { motionTokens } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { groundMesh } from "@/lib/foundry-ground";

/**
 * The page's own paper grain — fixed behind every plate on every route, not
 * a hero illustration. Each facet is a sliver of `--foreground` over
 * `--background` at 2-9% opacity with a hairline `--border` crease, so it
 * reads as texture in the stock the specimens are printed on rather than a
 * new colour or shape language competing with them. The whole field drifts
 * a couple of motion-token pixels over a very slow, looping ease, as if the
 * sheet were catching a slowly moving light.
 *
 * Solid surfaces (the header, the proof slip, stage chips) sit fully opaque
 * on top and occlude it entirely — the grain only shows in the paper margins
 * between plates, which is exactly where the ground otherwise read as flat.
 */
export function FoundryGround() {
  const reducedMotion = usePrefersReducedMotion();
  const { width, height, margin, triangles } = groundMesh;
  const driftX = motionTokens.distance.lg;
  const driftY = motionTokens.distance.md;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <rect
          x={-margin}
          y={-margin}
          width={width + margin * 2}
          height={height + margin * 2}
          fill="var(--background)"
        />
        <motion.g
          animate={reducedMotion ? undefined : { x: [0, -driftX, 0], y: [0, driftY, 0] }}
          transition={
            reducedMotion
              ? undefined
              : {
                  duration: motionTokens.duration.ambient,
                  ease: motionTokens.easing.smooth,
                  repeat: Infinity,
                }
          }
        >
          {triangles.map((triangle, index) => (
            <polygon
              key={index}
              points={triangle.points}
              fill="var(--foreground)"
              fillOpacity={triangle.opacity}
              stroke="var(--border)"
              strokeOpacity={0.4}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </motion.g>
      </svg>
    </div>
  );
}
