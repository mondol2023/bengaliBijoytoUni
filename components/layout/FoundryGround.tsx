"use client";

import { motion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { motionTokens, springs } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { farInkTile, nearAccentTile, nearInkTile, type GroundTile } from "@/lib/foundry-ground";

/** Sideways sway of the near layer, in px — the ground drifting as it passes, not sliding. */
const NEAR_SWAY = motionTokens.distance.lg;

/**
 * The page's own faceted paper — fixed behind every plate on every route,
 * and travelling with the scroll.
 *
 * Two depths: a far sheet of ink facets with hairline creases, and a nearer,
 * sparser layer of larger facets (a few in terracotta) that moves more than
 * twice as far for the same scroll. The difference in speed is what reads as
 * depth. Both follow the scroll through a soft spring, so the ground glides
 * and settles after the page stops instead of being bolted to it.
 *
 * Each layer is one repeating mask tile over a theme-token fill, moved only
 * by `transform` — composited by the GPU, so scrolling never repaints the
 * facets. Solid surfaces (header, sheets, proof slip) sit opaque on top; the
 * ground shows in the paper margins between them.
 */
export function FoundryGround() {
  const reducedMotion = usePrefersReducedMotion();
  const { scrollY } = useScroll();
  const glide = useSpring(scrollY, springs.glide);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <motion.div
        className="absolute inset-0"
        animate={
          reducedMotion
            ? undefined
            : { x: [0, -motionTokens.distance.md, 0], y: [0, motionTokens.distance.sm, 0] }
        }
        transition={
          reducedMotion
            ? undefined
            : { duration: motionTokens.duration.ambient, ease: motionTokens.easing.smooth, repeat: Infinity }
        }
      >
        <GroundLayer
          tile={farInkTile}
          fill="var(--foreground)"
          scroll={glide}
          travel={motionTokens.parallax.far}
          sway={0}
          still={reducedMotion}
        />
        <GroundLayer
          tile={nearInkTile}
          fill="var(--foreground)"
          scroll={glide}
          travel={motionTokens.parallax.near}
          sway={NEAR_SWAY}
          still={reducedMotion}
        />
        <GroundLayer
          tile={nearAccentTile}
          fill="var(--accent)"
          scroll={glide}
          travel={motionTokens.parallax.near}
          sway={NEAR_SWAY}
          still={reducedMotion}
        />
      </motion.div>

      {/* One soft light from the upper left: the sheet falls slightly into
          shade toward the far corner, so the facets are lit unevenly. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 12% 0%, transparent 45%, color-mix(in oklab, var(--foreground) 5%, transparent) 100%)",
        }}
      />
    </div>
  );
}

function GroundLayer({
  tile,
  fill,
  scroll,
  travel,
  sway,
  still,
}: {
  tile: GroundTile;
  fill: string;
  scroll: MotionValue<number>;
  /** Fraction of the scroll distance this layer moves. */
  travel: number;
  sway: number;
  still: boolean;
}) {
  // The tile repeats seamlessly, so wrapping the offset at one tile height
  // lets the layer travel forever inside a box only one tile taller than the
  // viewport.
  const y = useTransform(scroll, (value) => -((Math.max(0, value) * travel) % tile.height));
  const x = useTransform(scroll, (value) => Math.sin(Math.max(0, value) / 900) * sway);

  return (
    <motion.div
      className="absolute top-0"
      style={{
        left: -sway,
        right: -sway,
        height: `calc(100% + ${tile.height}px)`,
        backgroundColor: fill,
        maskImage: tile.mask,
        WebkitMaskImage: tile.mask,
        maskSize: `${tile.width}px ${tile.height}px`,
        WebkitMaskSize: `${tile.width}px ${tile.height}px`,
        maskRepeat: "repeat",
        WebkitMaskRepeat: "repeat",
        x: still ? 0 : x,
        y: still ? 0 : y,
        willChange: still ? undefined : "transform",
      }}
    />
  );
}
