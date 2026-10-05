"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { checkSpelling } from "@/features/comparison/spelling/checkSpelling";
import type { SideSpelling, SpellChecker } from "@/features/comparison/spelling/types";

export type SpellcheckStatus = "off" | "loading" | "ready" | "unavailable";

export interface ComparedTexts {
  source: string;
  target: string;
}

export interface UseSpellcheckResult {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  status: SpellcheckStatus;
  /** Present only while `status === "ready"` and there is something compared. */
  source: SideSpelling | null;
  target: SideSpelling | null;
  checker: SpellChecker | null;
  /** Suggestions found so far, keyed by lowercase word. Filled in gradually — see `useSuggestions`. */
  suggestions: Record<string, string[]>;
}

/** Per-browser preference, not account state. On unless the user turned it off. */
const STORAGE_KEY = "convert2uni:compare-spellcheck";

const listeners = new Set<() => void>();

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot = () => true;

/** Most distinct words that get a suggestion lookup; each one costs tens of milliseconds. */
const MAX_SUGGESTED_WORDS = 30;

/**
 * Suggestion lookups are slow compared to the check itself, so they run one
 * word per macrotask — the page stays responsive and the summary fills in.
 */
function useSuggestions(checker: SpellChecker | null, words: string[]): Record<string, string[]> {
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const looked = useRef(new Set<string>());
  const wordsKey = words.join("\u0000");

  useEffect(() => {
    if (!checker) return;
    const pending = wordsKey
      .split("\u0000")
      .filter((word) => word !== "" && !looked.current.has(word.toLowerCase()));
    if (pending.length === 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const step = (index: number) => {
      if (cancelled || index >= pending.length) return;
      const word = pending[index];
      const key = word.toLowerCase();
      looked.current.add(key);
      const found = checker.suggest(word);
      setSuggestions((previous) => ({ ...previous, [key]: found }));
      timer = setTimeout(() => step(index + 1), 0);
    };
    timer = setTimeout(() => step(0), 0);

    // A word is only recorded as looked-up when its turn comes, so words a
    // cancelled run never reached are simply picked up by the next one.
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checker, wordsKey]);

  return suggestions;
}

/**
 * Owns the Compare page's English spellcheck: the on/off preference, the lazy
 * dictionary load, and the per-side results for the texts that were compared.
 *
 * The dictionary is dynamically imported only when the feature is on and
 * there is something to check, so it never touches the initial bundle and a
 * visitor who turns the feature off never downloads it. A failed load sets
 * `unavailable` and nothing else — the diff does not depend on any of this.
 */
export function useSpellcheck(compared: ComparedTexts | null): UseSpellcheckResult {
  const enabled = useSyncExternalStore(subscribe, readPreference, serverSnapshot);
  const [checker, setChecker] = useState<SpellChecker | null>(null);
  const [failed, setFailed] = useState(false);
  const wanted = enabled && compared !== null;

  useEffect(() => {
    if (!wanted || checker) return;
    let cancelled = false;
    import("@/features/comparison/spelling/loadChecker")
      .then(({ loadEnglishSpellChecker }) => loadEnglishSpellChecker())
      .then((loaded) => {
        if (cancelled) return;
        setFailed(false);
        setChecker(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, checker]);

  const source = useMemo(
    () => (enabled && checker && compared ? checkSpelling(compared.source, checker) : null),
    [enabled, checker, compared],
  );
  const target = useMemo(
    () => (enabled && checker && compared ? checkSpelling(compared.target, checker) : null),
    [enabled, checker, compared],
  );

  const suggestWords = useMemo(() => {
    const totals = new Map<string, { word: string; count: number }>();
    for (const side of [source, target]) {
      for (const { word, count } of side?.words ?? []) {
        const entry = totals.get(word.toLowerCase());
        if (entry) entry.count += count;
        else totals.set(word.toLowerCase(), { word, count });
      }
    }
    return [...totals.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_SUGGESTED_WORDS)
      .map((entry) => entry.word);
  }, [source, target]);
  const suggestions = useSuggestions(checker, suggestWords);

  function setEnabled(next: boolean) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Private mode or blocked storage: the preference just does not persist.
    }
    listeners.forEach((listener) => listener());
  }

  const status: SpellcheckStatus = !enabled
    ? "off"
    : checker
      ? "ready"
      : failed
        ? "unavailable"
        : "loading";

  return { enabled, setEnabled, status, source, target, checker, suggestions };
}
