# Compare: English spelling detection

Status: approved in chat 2026-10-05 (scope: both sides, marked in the diff + summarized in the
figures strip). Written for the record; the implementation follows it.

## Goal

On the Compare page, flag misspelled **English** words on both sides, mark them inside the diff
output, and summarize them. Bengali (Unicode or legacy) is never flagged. The diff itself, its
statistics and its tests are unchanged.

## Non-goals

Bengali spellcheck, user dictionaries, auto-correct/replace, other languages.

## Domain constraint: reference numbers

Compare is used on case files, bank bills and land records, so the text is dense with references:
`123/2020`, `Dag No. 45/B`, `Khatian 12/3`, `A/C 0012-3456`, `Rs.5000/-`, `C/O`, `L/C`, `S.A.`.
These must never be flagged. Rules (see `features/comparison/spelling/tokenize.ts`):

1. A whitespace-delimited chunk that contains a digit (ASCII or Bengali), `@ \ _ # = < > | ~ ^`,
   `://`, a `www.` prefix or a web TLD is a *reference*: the whole chunk is skipped.
2. A letters-only chunk containing `/` is a *slashed code* (`A/C`, `his/her`, `Dag/Khatian`):
   parts are only checked at 4+ letters, so `A/C`, `C/O`, `S/O`, `W/O`, `B/L`, `L/C`, `T/T`,
   `N/A` are structurally safe.
3. Words shorter than 3 letters are skipped, mixed-case words (`iPhone`) are skipped, ALL-CAPS
   words are skipped under 6 letters (acronyms: `NEFT`, `RTGS`, `TIN`).
4. A built-in allowlist covers transliterated land/legal/banking vocabulary (`mouza`, `khatian`,
   `dag`, `dolil`, `thana`, `upazila`, `cheque`, `lakh`, `crore`, `taka`, ...).
5. Names: a Capitalized word that is not at the start of a sentence is a proper noun. At a
   sentence start it is a proper noun only if it sits next to another Capitalized word
   (`Rahim Uddin`) or the same word appears capitalized mid-sentence elsewhere in that text.
   Known trade-off: `Please Recieve` (capitalized, mid-sentence) is not flagged.
6. After the dictionary says "wrong": Roman numerals (`xii`) and repeated-letter noise (`zzz`)
   are skipped.

## Legacy gate

Legacy Bijoy text is Latin-looking gibberish, so a side that looks legacy is skipped entirely and
the UI says so. `detectEncoding` cannot be the gate on its own (it scores pure English as a
confident Bijoy match, because it reports legacy-range coverage 1 when there are no high
characters). A side is legacy when at least 3% of its non-space characters are legacy marker
characters ("strong" markers such as `† ‡ © ¤`, at least 3 of them), or at least 8% are any
Latin-1 / CP1252 high character — and in both cases there are fewer Bengali letters than high
characters (already-Unicode Bengali is never legacy). Typographic quotes, dashes and ellipses
are not markers; English uses them. Pure-ASCII legacy snippets with no marker
characters cannot be told from English; the "Check English spelling" toggle is the escape hatch.
Independently of the gate, a Latin word glued to a non-ASCII letter is never checked.

## Architecture

- `features/comparison/spelling/` — pure TypeScript, no React, no Node core modules:
  `types.ts`, `tokenize.ts`, `allowlist.ts`, `legacyGate.ts`, `checkSpelling.ts`,
  `annotate.ts` (maps misspellings onto diff segments), `loadChecker.ts` (lazy browser loader).
- `hooks/useSpellcheck.ts` — owns loading state, runs the check on the debounced texts, fills
  suggestions progressively (suggestion lookup is slow; it must not block render).
- `components/comparison/SpellingSummary.tsx`, plus changes to `DiffViewer`, `ComparisonStats`,
  `ComparisonWorkspace`.
- Dictionary: Hunspell files copied from `dictionary-en` and `dictionary-en-gb` into
  `public/dictionaries/{en,en-gb}/` (those packages read files with `node:fs` and cannot be
  bundled for the browser) and fetched on first use. `npm run dict:sync` re-copies them.
  **Both British and US English are loaded and a word is correct if either accepts it** — added
  after a probe showed `colour`/`organisation`/`judgement` flagged; the documents this tool is
  used on are mostly British-spelled. Licence `(MIT AND BSD)`, shipped as `LICENSE.txt`.
  `next.config.ts` serves `/dictionaries/*` with a day of caching (Next's default is
  `max-age=0`, which would re-validate ~1.1MB every visit).
- Suggestions: adjacent-letter swaps that form a real word go first (`teh` -> `the`), then
  Hunspell's, British first, at most three. Hunspell alone ranked `teh` -> "ten, eh, meh".
- The checker is injected into the pure engine (`SpellChecker { correct, suggest }`), so unit
  tests use a fake and one integration test uses the real dictionary.

## Data flow

Type → 250 ms debounce (existing) → `compareText` as before. In parallel `useSpellcheck` loads
the dictionary once, checks both debounced texts, and the viewer overlays marks. The diff never
waits on the dictionary; a load failure sets status `unavailable` and everything else works.

## Mapping marks onto the diff

Word mode: segment values concatenate back to the exact source (unchanged + removed) and target
(unchanged + added), so the full-text misspellings (which keep whole-text context, e.g. the
`12/` + `2020` chunk) are mapped by offset. Paragraph mode, or any reconstruction mismatch: each
segment is checked on its own.

## Preference

"Check English spelling" checkbox in the settings row, on by default, persisted per browser in
`localStorage` (`convert2uni:compare-spellcheck`) with the same `useSyncExternalStore` pattern as
the document page's auto-AI switch.

## Accessibility

Marks use a wavy underline offset below the diff's own underline, an amber tint, and an sr-only
"Possible misspelling" prefix; meaning never rests on colour alone. The summary is a labelled
region.

## Known trade-offs (deliberate)

- `Please Recieve` — a Capitalized word mid-sentence is treated as a proper noun and not flagged.
- `teh/the` — a 3-letter part of a letters-only slashed chunk is not checked (`A/C`, `C/O`, `L/C`
  must stay safe); parts of 4+ letters are.
- Repeated words (`the the`) are not reported; this is spelling, not grammar.
- A pure-ASCII legacy snippet with no marker characters is indistinguishable from English.
- A chunk containing any digit is skipped whole, so a typo glued to a number (`recieve2020`) is not
  reported.
