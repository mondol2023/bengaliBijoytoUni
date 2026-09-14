import { ArrowRight } from "lucide-react";
import { compareText } from "@/features/comparison/engine/diffEngine";
import { SAMPLE_SOURCE, SAMPLE_TARGET } from "@/features/comparison/sampleText";
import { DiffSpecimen } from "./DiffSpecimen";
import { LinkButton } from "./LinkButton";
import { PlateHead } from "./PlateHead";

/**
 * A server component on purpose. The real engine runs on the real built-in
 * example — the same pair `/compare` loads from its "Load example" action,
 * diffed by the same function — but it runs at build time, so the `diff`
 * package never ships to the landing page's client bundle. The similarity
 * figure below is whatever the engine returned, not a number chosen to look
 * good.
 *
 * The built-in pair is two drafts of one notice, not a legacy source and its
 * conversion. The captions say so: the compare view is a general two-text
 * proofreading tool, and reading it as a record of what the converter did
 * would be reading it wrong.
 */
export function ComparisonPlate() {
  const diff = compareText("word", SAMPLE_SOURCE, SAMPLE_TARGET);

  const readouts = [
    { label: "Similarity", value: `${Math.round(diff.similarity * 100)}%` },
    { label: "Words in", value: String(diff.statistics.sourceWords) },
    { label: "Words out", value: String(diff.statistics.targetWords) },
    { label: "Changed", value: String(diff.statistics.changedWords) },
  ];

  return (
    <section aria-labelledby="comparison-heading" className="plate">
      <PlateHead
        headingId="comparison-heading"
        marker="Plate 04"
        heading="Every word that moved between two drafts, marked."
        standfirst="Converting is half the job; checking it is the other half. The compare view takes any two texts and marks every word that differs, so proofreading a converted document means reading the marks instead of re-reading the page. The example below is two drafts of an ordinary notice — not a conversion — because edits you can see at a glance show the marking clearly."
      />

      <figure className="mt-8">
        <figcaption className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border pb-3">
          <span className="plate-marker">Built-in example · two drafts of one notice · word mode</span>
          <span className="plate-marker">Removed struck · added underlined</span>
        </figcaption>

        <DiffSpecimen segments={diff.segments} />

        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-4">
          {readouts.map(({ label, value }) => (
            <div key={label}>
              <dt className="plate-marker">{label}</dt>
              <dd className="mt-1 font-mono text-xl tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </figure>

      <div className="mt-8">
        <LinkButton href="/compare" variant="quiet" className="px-0">
          Compare your own text
          <ArrowRight className="h-4 w-4" aria-hidden />
        </LinkButton>
      </div>
    </section>
  );
}
