"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  FileType2,
  Layers,
  Scale,
  ServerCog,
  type LucideIcon,
} from "lucide-react";
import { motion, type Variants } from "motion/react";
import { motionTokens, staggerChildren } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { PlateHead } from "./PlateHead";

interface Capability {
  icon: LucideIcon;
  title: string;
  body: string;
  /** The measurable fact behind the claim, set as data rather than prose. */
  readout: string;
  /** A limit stated plainly is worth more here than a claim. */
  caveat?: boolean;
}

/**
 * Every line here is checkable against the code that ships: the encodings in
 * the registry, the extensions `resolveFileFormat` accepts, the size cap in
 * `features/documents/config.ts`, and the thresholds in the extractors. The
 * two rows marked as caveats are limits, and they are on the page for the
 * same reason the unmapped count is on the demo.
 */
const CAPABILITIES: Capability[] = [
  {
    icon: Layers,
    title: "Two legacy encodings, mapped rule by rule",
    body: "Bijoy Classic and SutonnyMJ each have their own table of byte sequences and their own reordering quirks. Both are still converging — the tables grow as real documents turn up sequences they miss.",
    readout: "Bijoy · SutonnyMJ",
    caveat: true,
  },
  {
    icon: FileType2,
    title: "Whole documents, not just a text box",
    body: "Upload a PDF, DOCX, DOC or TXT and get the text back re-set as Unicode, with the same read-out the demo above gives you.",
    readout: ".pdf .docx .doc .txt · 15 MB",
  },
  {
    icon: ServerCog,
    title: "Text converts here, documents convert on the server",
    body: "Typed and pasted text never leaves the tab — the engine is plain TypeScript running in your browser. Files do get uploaded, because reading a PDF or DOCX needs a server runtime to unpack it first.",
    readout: "client · server split",
  },
  {
    icon: AlertTriangle,
    title: "Legacy .doc fails loudly instead of quietly",
    body: "Binary .doc extraction is best-effort. If more than 2% of what comes out is replacement or control characters, the upload is refused and you are asked for a .docx, .pdf or .txt instead of handed mangled text.",
    readout: "refuses above 2%",
    caveat: true,
  },
  {
    icon: Scale,
    title: "Unmapped sequences are counted, never guessed",
    body: "The last stage of the pipeline reports every sequence it had no rule for. They pass through unchanged and show up in the read-out, so you always know what to check by hand.",
    readout: "validate stage",
  },
  {
    icon: ArrowDownToLine,
    title: "Take the result and go",
    body: "Copy it, or download it as UTF-8 plain text straight from the browser. An account is optional and only exists to keep your conversion history.",
    readout: "UTF-8 .txt",
  },
];

const row: Variants = {
  hidden: { opacity: 0, y: motionTokens.distance.md },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.slow, ease: motionTokens.easing.expoOut },
  },
};

export function CapabilityPlate() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <section aria-labelledby="capability-heading" className="plate">
      <PlateHead
        headingId="capability-heading"
        marker="Plate 02"
        heading="What it actually does, and where it stops."
        standfirst="Six facts you can check against the running code. Two of them are limits — they are here on purpose, because a converter that hides its failures is worse than one that names them."
      />

      <motion.ul
        initial={reducedMotion ? undefined : "hidden"}
        whileInView={reducedMotion ? undefined : "shown"}
        viewport={{ once: true, amount: 0.15 }}
        variants={{ hidden: {}, shown: { transition: { staggerChildren } } }}
        className="mt-2"
      >
        {CAPABILITIES.map(({ icon: Icon, title, body, readout, caveat }) => (
          <motion.li
            key={title}
            variants={reducedMotion ? undefined : row}
            className="rule-row group grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2 py-7 sm:grid-cols-[auto_1fr_auto] sm:gap-x-6"
          >
            <Icon
              aria-hidden
              strokeWidth={1.5}
              className={`mt-0.5 h-5 w-5 shrink-0 transition-colors duration-200 ${
                caveat ? "text-warning" : "text-foreground/65 group-hover:text-accent"
              }`}
            />

            <div className="min-w-0">
              <h3 className="text-balance text-lg font-medium leading-snug tracking-tight">
                {title}
              </h3>
              <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-foreground/75">{body}</p>
            </div>

            <span
              className={`plate-marker col-start-2 sm:col-start-3 sm:pt-1 sm:text-right ${
                caveat ? "text-warning" : ""
              }`}
            >
              {readout}
            </span>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
