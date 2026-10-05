import nspell from "nspell";
import type { SpellChecker } from "./types";

/**
 * Hunspell data the checker is built from, served from
 * `public/dictionaries/` (copied out of the `dictionary-en*` packages by
 * `npm run dict:sync` — those packages read their files with `node:fs`, so
 * they cannot be bundled for the browser).
 *
 * Both British and US English are loaded, and a word is correct if *either*
 * accepts it: the legal, banking and land documents this tool compares are
 * overwhelmingly written in British spelling (`colour`, `organisation`,
 * `judgement`) and flagging that would bury the real typos. British comes
 * first so its suggestions lead.
 */
export const ENGLISH_DICTIONARIES = [
  { id: "en-gb", aff: "/dictionaries/en-gb/en-gb.aff", dic: "/dictionaries/en-gb/en-gb.dic" },
  { id: "en", aff: "/dictionaries/en/en.aff", dic: "/dictionaries/en/en.dic" },
] as const;

export interface HunspellData {
  aff: string;
  dic: string;
}

/** How many suggestions a lookup returns at most — more than this is noise in the UI. */
const MAX_SUGGESTIONS = 3;

/** `teh` -> [`eth`, `the`]: every word with one pair of neighbouring letters swapped. */
function adjacentSwaps(word: string): string[] {
  const swaps: string[] = [];
  for (let i = 0; i < word.length - 1; i++) {
    if (word[i] === word[i + 1]) continue;
    swaps.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
  return swaps;
}

/**
 * Builds one checker from raw Hunspell `.aff` / `.dic` text for one or more
 * dictionaries, earlier ones preferred. Pure; used by the loader and by tests.
 */
export function createSpellChecker(...dictionaries: HunspellData[]): SpellChecker {
  const spellers = dictionaries.map(({ aff, dic }) => nspell(aff, dic));

  const correct = (word: string) => spellers.some((speller) => speller.correct(word));

  return {
    correct,
    suggest: (word) => {
      // Swapped neighbouring letters are the commonest typing slip (`teh`,
      // `recieve`) and Hunspell's ranking can bury the fix ("teh" -> "ten, eh,
      // meh"), so a swap that yields a real word goes first.
      const suggestions = adjacentSwaps(word).filter(correct);
      for (const speller of spellers) {
        for (const candidate of speller.suggest(word)) {
          if (!suggestions.includes(candidate)) suggestions.push(candidate);
        }
        if (suggestions.length >= MAX_SUGGESTIONS) break;
      }
      return suggestions.slice(0, MAX_SUGGESTIONS);
    },
  };
}

let loading: Promise<SpellChecker> | null = null;

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.text();
}

/**
 * Fetches and builds the English checker once per page; every caller shares
 * the same promise. A failure is not cached, so a later attempt (a flaky
 * connection, the user toggling the feature) can succeed.
 */
export function loadEnglishSpellChecker(fetchImpl: typeof fetch = fetch): Promise<SpellChecker> {
  if (!loading) {
    loading = Promise.all(
      ENGLISH_DICTIONARIES.map(async ({ aff, dic }) => ({
        aff: await fetchText(aff, fetchImpl),
        dic: await fetchText(dic, fetchImpl),
      })),
    )
      .then((dictionaries) => createSpellChecker(...dictionaries))
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}
