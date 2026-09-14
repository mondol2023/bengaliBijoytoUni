import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SpecimenProvider } from "@/features/landing/SpecimenProvider";
import { CapabilityPlate } from "@/features/landing/components/CapabilityPlate";
import { ClosingPlate } from "@/features/landing/components/ClosingPlate";
import { ComparisonPlate } from "@/features/landing/components/ComparisonPlate";
import { PipelinePlate } from "@/features/landing/components/PipelinePlate";
import { SpecimenHero } from "@/features/landing/components/SpecimenHero";
import { TiersPlate } from "@/features/landing/components/TiersPlate";

export const metadata: Metadata = {
  title: "Convert2Uni — Legacy Bengali, re-set as Unicode",
  description:
    "Bijoy and SutonnyMJ text that renders as gibberish, converted to standard Unicode. Convert whole PDF, DOCX, DOC and TXT documents, compare the result against the original, and see exactly which sequences could not be mapped.",
};

/**
 * The landing page is set as a run of numbered plates from a type specimen
 * book. One input threads through all of them: whatever is in the proof slip
 * in Plate 01 is what the giant specimen sets, what Plate 03 walks station by
 * station, and what the read-outs count — so the page argues by converting
 * the visitor's own text rather than by describing that it could.
 */
export default function Home() {
  return (
    <SpecimenProvider>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <SpecimenHero />
        <CapabilityPlate />
        <PipelinePlate />
        <ComparisonPlate />
        <TiersPlate />
        <ClosingPlate />
      </main>
      <SiteFooter />
    </SpecimenProvider>
  );
}
