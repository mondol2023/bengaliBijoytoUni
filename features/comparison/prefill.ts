/**
 * One-shot hand-off of text from another page into the Compare source field.
 *
 * `/ocr` stashes its result here and navigates to `/compare`; Compare takes it once on mount.
 * sessionStorage (not a query string) because the text can be many KB, and it must not reach a
 * server, a log or the browser history. Pure: storage is injected so it runs in Node tests.
 */

export const COMPARE_PREFILL_KEY = "c2u:compare-prefill";

/** A stash this old was left by a navigation that never finished, so it is dropped rather than surprising a later visit. */
export const COMPARE_PREFILL_MAX_AGE_MS = 2 * 60 * 1000;

const VERSION = 1;

export interface PrefillStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `false` when there was nothing worth stashing or storage refused it (quota, private mode, no storage). */
export function stashComparePrefill(storage: PrefillStorage | null, text: string, now: number): boolean {
  if (storage === null || text.trim() === "") return false;
  try {
    storage.setItem(COMPARE_PREFILL_KEY, JSON.stringify({ v: VERSION, text, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** Reads the stash and clears it in the same call. Anything unusable is cleared too and reads as `null`. */
export function takeComparePrefill(storage: PrefillStorage | null, now: number): string | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(COMPARE_PREFILL_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    storage.removeItem(COMPARE_PREFILL_KEY);
  } catch {
    // Reading already succeeded; a stash we cannot clear must not block the hand-off.
  }
  return parse(raw, now);
}

function parse(raw: string, now: number): string | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { v, text, at } = value as Record<string, unknown>;
  if (v !== VERSION || typeof text !== "string" || text === "" || typeof at !== "number") return null;
  const age = now - at;
  if (age < 0 || age > COMPARE_PREFILL_MAX_AGE_MS) return null;
  return text;
}

/** The tab's sessionStorage, or `null` where the browser blocks it (the accessor itself can throw). */
export function browserPrefillStorage(): PrefillStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
