"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { AUTO_DETECT, type EncodingChoice } from "@/features/converter/constants";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  DEMO_FALLBACK,
  readSpecimen,
  tracePipeline,
  type PipelineStage,
  type SpecimenReading,
} from "./specimen";

/**
 * One input, propagated down the whole page. What the visitor types into the
 * hero's proof slip is what the giant specimen sets, what the pipeline
 * section walks stage by stage, and what the comparison plate diffs — so the
 * page argues with the visitor's own text rather than with a canned example.
 *
 * Conversion is pure client-side TS, so this needs no fetch and no server
 * round-trip; the debounce exists only to keep the re-render off every
 * keystroke, not to protect a network call.
 */

interface SpecimenContextValue {
  /** Raw textarea value — empty means "showing the built-in sample". */
  draft: string;
  setDraft: (value: string) => void;
  choice: EncodingChoice;
  setChoice: (value: EncodingChoice) => void;
  /** Text actually converted: the draft, or the sample while the draft is empty. */
  source: string;
  isSample: boolean;
  reading: SpecimenReading | null;
  stages: PipelineStage[];
}

const SpecimenContext = createContext<SpecimenContextValue | null>(null);

/** Long enough to skip intermediate keystrokes, short enough to feel live. */
const TYPING_SETTLE_MS = 120;

export function SpecimenProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState("");
  const [choice, setChoice] = useState<EncodingChoice>(AUTO_DETECT);
  const settledDraft = useDebouncedValue(draft, TYPING_SETTLE_MS);

  const isSample = settledDraft.trim().length === 0;
  const source = isSample ? DEMO_FALLBACK : settledDraft;

  const reading = useMemo(() => readSpecimen(source, choice), [source, choice]);
  const stages = useMemo(
    () => (reading ? tracePipeline(source, reading.encodingId) : []),
    [source, reading],
  );

  const value = useMemo<SpecimenContextValue>(
    () => ({ draft, setDraft, choice, setChoice, source, isSample, reading, stages }),
    [draft, choice, source, isSample, reading, stages],
  );

  return <SpecimenContext.Provider value={value}>{children}</SpecimenContext.Provider>;
}

export function useSpecimen(): SpecimenContextValue {
  const value = useContext(SpecimenContext);
  if (!value) throw new Error("useSpecimen must be used inside <SpecimenProvider>.");
  return value;
}
