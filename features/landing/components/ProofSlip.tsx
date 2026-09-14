"use client";

import { useId } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AUTO_DETECT } from "@/features/converter/constants";
import { listEncodings } from "@/features/converter/encodings/registry";
import { SAMPLE_TEXT } from "@/features/converter/sampleText";
import { motionTokens } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useSpecimen } from "../SpecimenProvider";

const CHOICES = [
  { id: AUTO_DETECT as string, label: "Auto" },
  ...listEncodings().map((encoding) => ({ id: encoding.id, label: encoding.name })),
];

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The live demo, framed as a letterpress proof slip: legacy bytes go in the
 * galley at the top, the pulled proof sits under the rule, and the foot rule
 * carries the read-out — including the count of sequences the tables could
 * not map, which is shown rather than hidden.
 */
export function ProofSlip() {
  const { draft, setDraft, choice, setChoice, isSample, reading } = useSpecimen();
  const reducedMotion = usePrefersReducedMotion();
  const inputId = useId();
  const hintId = useId();

  const output = reading?.unicodeText ?? "";
  const unmapped = reading?.unmappedSequences ?? [];

  return (
    <div className="border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <label htmlFor={inputId} className="plate-marker">
          Legacy text
        </label>
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Legacy encoding</legend>
          {CHOICES.map((option) => (
            <div key={option.id} className="relative">
              <input
                type="radio"
                id={`landing-encoding-${option.id}`}
                name="landing-encoding"
                className="peer sr-only"
                checked={choice === option.id}
                onChange={() => setChoice(option.id)}
              />
              <label
                htmlFor={`landing-encoding-${option.id}`}
                className="block cursor-pointer rounded-sm border border-transparent px-2 py-1 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-foreground/70 transition-colors hover:text-foreground peer-checked:border-border peer-checked:bg-accent-muted peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              >
                {option.label}
              </label>
            </div>
          ))}
        </fieldset>
      </div>

      <textarea
        id={inputId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        rows={3}
        placeholder={`Paste your broken text here — e.g. ${SAMPLE_TEXT.bijoy}`}
        aria-describedby={hintId}
        className="block w-full resize-y bg-transparent px-4 pb-2 pt-4 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground/70 focus-visible:bg-surface-muted"
      />

      {/* The textarea's description. Static text, deliberately not the live
          region below it — that node already announces on every keystroke, and
          pointing `aria-describedby` at it made focus repeat the conversion. */}
      <p id={hintId} className="px-4 pb-4 text-xs leading-relaxed text-foreground/70">
        {isSample
          ? "Pre-filled with a synthetic sample — built only from sequences the tables already cover, so it maps cleanly. Paste real text to see where the gaps are."
          : "Converts as you type, in this tab."}
      </p>

      <div className="flex items-center justify-between gap-3 border-y border-border bg-surface-muted px-4 py-1.5">
        <span className="plate-marker">
          {isSample ? "Synthetic sample" : "Your text"} → Unicode
        </span>
        {draft.trim().length > 0 ? (
          <button
            type="button"
            onClick={() => setDraft("")}
            className="rounded-sm font-mono text-[0.7rem] uppercase tracking-[0.12em] text-foreground/70 underline decoration-border underline-offset-4 transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Clear
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setDraft(SAMPLE_TEXT.sutonny)}
            className="rounded-sm font-mono text-[0.7rem] uppercase tracking-[0.12em] text-foreground/70 underline decoration-border underline-offset-4 transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Try SutonnyMJ
          </button>
        )}
      </div>

      <div aria-live="polite" className="min-h-[5.5rem] px-4 py-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={output || "empty"}
            lang="bn"
            initial={reducedMotion ? false : { opacity: 0, y: motionTokens.distance.xs }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -motionTokens.distance.xs }}
            transition={{ duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }}
            className="font-bengali text-xl leading-relaxed break-words"
          >
            {output || "—"}
          </motion.p>
        </AnimatePresence>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border px-4 py-3 sm:grid-cols-4">
        <ReadoutCell label="Encoding" value={reading?.encodingName ?? "—"} />
        <ReadoutCell
          label={reading?.detected ? "Detected" : "Chosen"}
          value={reading ? percent(reading.confidence) : "—"}
        />
        <ReadoutCell label="Characters" value={reading ? String(reading.charCount) : "—"} />
        <ReadoutCell
          label="Unmapped"
          value={String(unmapped.length)}
          tone={unmapped.length > 0 ? "warning" : "ok"}
        />
      </dl>

      <AnimatePresence initial={false}>
        {unmapped.length > 0 ? (
          <motion.div
            key="unmapped"
            initial={reducedMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }}
            className="overflow-hidden border-t border-border"
          >
            <p className="px-4 py-3 text-xs leading-relaxed text-warning">
              No rule for{" "}
              <span className="font-mono">{unmapped.slice(0, 8).join(" · ")}</span>
              {unmapped.length > 8 ? ` and ${unmapped.length - 8} more` : ""}. These are passed
              through unchanged and counted, never guessed at.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ReadoutCell({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warning";
}) {
  return (
    <div>
      <dt className="plate-marker">{label}</dt>
      <dd
        className={`mt-0.5 font-mono text-sm tabular-nums ${
          tone === "warning" ? "text-warning" : "text-foreground"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
