import type { Metadata } from "next";
import { ThreeShowcase } from "@/components/lab/ThreeShowcase";

export const metadata: Metadata = {
  title: "Three.js Lab — Convert2Uni",
  description: "A standalone three.js feature showcase: lighting, shadows, materials, and GLB animation.",
};

export default function ThreeLabPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Three.js Lab</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground/70">
          A self-contained experiment page — not part of the converter&apos;s design system. Drag to orbit,
          hover a shape to highlight it. Directional light + shadows, an orbiting spot light, varied
          roughness/metalness materials, a procedural ground texture, an optional animated GLB played
          through an <code>AnimationMixer</code>, and a color cycle across grey / indigo / green / red.
        </p>
      </header>
      <ThreeShowcase />
    </main>
  );
}
