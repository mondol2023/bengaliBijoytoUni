# Conversion engine review — 2026-10-10

Written for: the project owner, to see what changed and what to decide.

## 1. The error log: what I could and could not read

The live error log lives in Firestore (`errorLogs`, `failurePatterns`, `conversionFailures`).
I tried a read-only dump with the service-account key in `.env.local`. The session's permission
guard blocked it as a **production read**, and I did not work around it. So **no live log data was
analysed**, and nothing below claims otherwise.

What I used instead:

- The record of the earlier log review: E1–E6 in the git history (SutonnyMJ alias, BOM, source hygiene,
  already-Unicode input, ZWJ/ZWNJ, unfinished clusters). All six are fixed, with regression tests.
- Probing and fuzzing the engine directly (below).

**To get the real log analysed**, either open `/admin/conversion-failures` and paste me the top
patterns, or allow the read. For example, add a Bash permission rule for the read-only dump script
and tell me to go ahead.

## 2. What I changed (3 files, all tested)

| File | Change | Why |
|---|---|---|
| `features/converter/engine/reorder.ts` | The reph back-scan no longer walks through rephs already placed. | **Real defect.** A placed reph (`র্`) ends in a hasant, so it matched the "half form" pattern and the scan walked back through every earlier reph. Reordering was O(n²): **20,000 rephs took 7.8 s** and froze the tab. Output text is identical (checked with a doubled-reph test). |
| `features/converter/engine/validate.ts` | The "had no mapping rule" warning names at most 20 sequences, most frequent first, then "…and N more". | Pasting the wrong script (for example CJK) made every character its own sequence. One warning string then listed about 20,000 of them, and that string is copied into the UI and error-log rows. The full list stays in `unmappedDetails`. |
| `__tests__/reorder.test.ts`, `__tests__/validate.test.ts` | Regression tests for both. | Written failing first for the reph case. |

Effect of the validate change: `unmappedSequences` is now ordered by count instead of first
occurrence. No consumer depended on the old order, and all tests pass.

**Validation (run from `convert2uni/`):**

- `npx tsc --noEmit`: exit 0
- `npm run lint`: exit 0
- `npx vitest run`: 146 files, 2488 tests, all passing
- `npm run build`: exit 0

I did **not** bump `CONVERSION_ENGINE_VERSION`. Converted text is unchanged for all inputs, and a bump
would invalidate caches and trigger the failure-pattern re-verification sweep for no benefit.
I did not commit anything. Your uncommitted edit to `hooks/useDocumentConversion.ts` was already there and is untouched.

## 3. What I checked and found sound

- About 117 common Bijoy words (conjuncts, reph + ে, ো/ৌ, ড়/য়, digits, quotes, taka): all correct.
  The 14 mismatches were wrong bytes that I typed from memory, not engine errors.
- Grammar-based fuzz of 20,000 well-formed words, with an independent oracle (reph, pre-base vowel,
  folas, half forms, conjuncts). The only disagreements were the `è`/`œ` cases in section 4.
- Throughput: about 3.2M characters in 1.4 s; 20,000 distinct unmapped characters in 75 ms.

## 4. Decisions for you (I did not change these)

1. **`Kè` → ক্ন and `nœ` → হ্ণ look swapped.**
   - Elsewhere the table says `è` = ্ণ and `œ` = ্ন (`Yè` = ণ্ণ, `bœ` = ন্ন, and a fixture pins `nè` = হ্ণ).
   - So `Kè` would be ক্ণ, which barely exists in Bangla, and `nœ` would be হ্ন, which is common (চিহ্ন).
   - Both entries match the upstream OpenBangla/poriborton table, so this is inherited, not introduced here.
   - I won't change a mapping without a real document or a second source (the project's own rule).
   - If you have a Bijoy document containing হ্ন or হ্ণ (পূর্বাহ্ণ / মধ্যাহ্ন), send it and I'll settle it.
2. **Mixed Unicode + legacy text.** Each Unicode Bengali letter is reported as "unmapped"
   (one such paste gave 7 sequences). It can never be fixed by a mapping rule, so it files noise rows.
   Passing the Bengali block through as already-converted text would stop that.
   An existing test records the current behavior as deliberate ("honest per-character reporting"), so I
   left it. Say the word and I'll change it, behind an engine-version bump.
3. **Bytes still unmapped in Bijoy**, left alone because each is single-source or deliberately excluded:
   `‘` (U+2018; the GPL table reads it as ্তু), `Ÿ` (appears only inside `nŸ`), `¡ ¢ £ ¥ §`
   (alpha-ANSI vowel signs; excluded to keep encoding detection working), `¹ º`, `–`.
   Real unmapped hits from the live log would show which of these matter.
4. **A pre-base vowel followed by whitespace/newline** (`w\nK`) is released after the whitespace
   (`\nিক`). This only happens on malformed input or a bad PDF line wrap, so I left it.

## 5. Suggested next steps

1. Re-run this review with real data: paste the top `failurePatterns`, or allow the read-only dump.
2. Send a real Bijoy page with its correct Unicode. Adding it to `__tests__/golden/` is the highest-value
   step, because that corpus is empty and every mapping decision above would then be checkable.
3. Decide items 1 and 2 in section 4.

## 6. Update — second pass on a real court document and three log excerpts

Written for: the project owner. This section supersedes the "Suggested next steps" above where they overlap.

### Status of the original list

| Item | State |
|---|---|
| Reph back-scan fix, warning cap, their tests | Done (uncommitted) |
| NFKC fold repair in `normalizeSource.ts` (`¨ ¯ µ ´ ¸ ³ …`) | Done (uncommitted; not in the first review) |
| Real error-log analysis | Still blocked on the production read. Three excerpts pasted by the owner are analysed below |
| Golden corpus | Still empty. The court passage is in `__tests__/courtDocument.test.ts` instead, because its Unicode is my reading, not an independently verified copy |
| Decisions 1–4 (§4) | Still open |

### Fixed in this pass (all with tests written first; engine 1.1.0 → 1.2.0)

| Symptom | Cause | Fix |
|---|---|---|
| `Ò3 (wZb)` came out “ক্ত (তিন) | The "3 glued to a letter" guess counted any Latin-1 character as a letter, including the quote byte `Ò` | Neighbours must be bytes the encoding maps to Bengali letters or signs. Digit bytes are excluded, so `2023` and `13` also stay numerals |
| `weiæ‡×` → বিরম্নদ্ধে | `æ` = ম্ন | `iæ` = রু; a bare `æ` is still ম্ন (`wbæ` = নিম্ন) |
| `ch©šÍ` → পর্যন্ত্ম | `Í` = ত্ম | `šÍ` = ন্ত; a bare `Í` is still ত্ম (`AvÍv` = আত্মা) |
| Log 1: lone `⁄` unmapped, `যুক্তিস১⁄২ত` | NFKC folds `½` to `1⁄2`; the fraction slash U+2044 is not a legacy byte | `1⁄2 1⁄4 3⁄4` are restored to `½ ¼ ¾` (ঙ্গ ঙ্ক জ্জ). Skipped in text that already holds Unicode Bengali |
| Log 2: `বিশ⟦¡⟧নাথ` | Bijoy has `K¡ R¡ Z¡ …` (ব-ফলা) but no `k¡` | Added `k¡` = শ্ব |

### Not fixable by a mapping rule

**Log 3 (61 unmapped, "vowel sign with no base consonant").** Thirteen of the listed bytes
(`` ‡ ` | ~ ^ _ † ƒ ÿ Î ¿ ß ú ``) are all mapped in the Bijoy table, and `⁄ ̈ ̄` are fold debris that the
Bijoy path now repairs. The text reads as Bijoy bytes that went through the **alpha-ANSI** table
(mixed digits and letters inside words, `|` where Bijoy has the danda). Likely causes: a wrong manual
encoding choice, or a DOCX/PDF font name routed to alpha-ANSI (`AdarshaLipi*` is the only such name).
I can't confirm which without the raw source text or the document's font name.

### Still open / suggested next

1. Send the raw source (or font name) behind log 3. A cheap guard would help regardless: when most unmapped
   bytes are ones another registered encoding maps, say "these bytes belong to Bijoy" instead of listing 61 characters.
2. Other consonants may be missing their `X¡` form (only `k¡` was evidenced). Add each from a real document, not by mirroring `X¦`.
3. Commit: reorder + validate fixes, fold repair, and this pass are all in the working tree.
4. Decide §4 items 1 and 2.

## 7. Update — two more log excerpts (102 unmapped, and a lone `¿`)

Written for: the project owner. Added to the plan only; no code changed for these two yet.

### Log 4: 102 unmapped — `$ * + । # = > < @ t | ú ~ ́ „`

**Diagnosis: the source is not Bijoy or alpha-ANSI text at all.** It is most likely a PDF whose
subset font has no `ToUnicode` map, so the extractor returned glyph codes in order of first use.

- The unmapped set is exactly the ASCII punctuation that is *not* in the tokenizer's shared-punctuation
  list (`$ * + # = < > @`). The punctuation that is in the list (`! " % ' ( ) , - .`) does not show
  up, because it is passed through silently. Together they form the contiguous run 0x21–0x3E.
- The context lines read like counters, not words: `! " #`, `( ' )`, `* + #`, `, - . - -`, `$ + = ! >`.
  A legacy-font page is mostly Latin *letters*, because that is where the consonants live. This
  page has almost none.
- `$`, `|`, `~` and `t` are all mapped in Bijoy (`৳ । ূ ঃ`), so they would not be unmapped if the page
  were Bijoy. No rule table can fix this.

**Plan:**
1. Do not add mappings. Any rule would be a guess, and the glyph order differs per document.
2. Add a guard in the PDF path. If the extracted text has a high share of ASCII punctuation, almost
   no Latin letters and runs of consecutive code points, report "this PDF's font has no text map; use
   OCR" and route to the existing `/ocr` flow, rather than listing 15 symbols.
   The Gemini auto-transcription (flag off) is the right place to hook this in.
3. Send the PDF (or its first page). I want to confirm the `ToUnicode` theory and the font name.

**One small real defect found on the way.** `।` (U+0964) is flagged unmapped. It sits in the
Devanagari block, so neither `SHARED_PUNCTUATION` (tokenize.ts:4) nor the Bengali-block checks cover
it, yet it is the normal Bengali danda. Pasted or mixed text with a real `।` files a false
"no mapping rule" row. Fix: add U+0964 and U+0965 to the shared list. It only changes validation
flags, not converted text. I'll add it with a failing test first once you say go.

### Log 5: a lone `¿` — `কি⟦¿⟧ষ গণস্বাস্থ্য`

**Diagnosis:** the text is alpha-ANSI. Its table has `¿` only as the first half of a pair:
`¿1` and `¿¹` = ন্ত, and `¿»` = ন্ত্র (`rules.ts:17` also joins it for the `Ñ¿1` reorder case).
A `¿` with none of those next to it is unmapped. (In Bijoy `¿` is a different byte, ্ত্র, so this is
not the Bijoy `¿`.) The word is almost certainly কিন্তু (`কিন্তু গণস্বাস্থ্য`), so ন্ত + ু is arriving
as `¿` + a byte that reads as ষ.

I can't say which byte without the source. Two candidates, neither yet verified:
- the `1` or `¹` that normally follows was lost or reshaped in transit; `¹` NFKC-folds to `1`, which
  the table already handles, so a different fold is the more likely culprit;
- this font encodes ন্তু as `¿` followed by its own ু byte.

**Plan:** send the raw bytes of that word. Then add one rule from that evidence, with a test in the
alpha-ANSI fixtures. Do not add a bare `¿` rule: in alpha-ANSI it is half a conjunct.

### Updated open list (replaces §6 "Still open")

1. Send the raw source or font name behind log 3 and the PDF behind log 4.
2. ~~Add the U+0964/U+0965 danda to the shared list~~ **Done** (uncommitted): `tokenize.ts` `SHARED_PUNCTUATION`, tests in `__tests__/danda.test.ts` (written failing first; validation-only, so no engine bump).
3. Add a "no text map, use OCR" guard for glyph-order PDFs (log 4).
4. Send the raw bytes of `কিন্তু` from log 5, then add one alpha-ANSI rule.
5. Add a "these bytes belong to Bijoy" hint when most unmapped bytes are mapped by another encoding (log 3).
6. Other consonants may lack an `X¡` form. Add each from a real document.
7. Commit the working tree. Nothing is committed yet.
8. Decide §4 items 1 and 2.

## 8. Update — land-suit log (167 unmapped, alpha-ANSI)

Root cause: the text is alpha-ANSI, and the table lacked these bytes. All fixed with tests written first (`__tests__/alphaAnsiLandSuit.test.ts`), engine 1.2.0 → 1.3.0. Uncommitted.

| Bytes | Now reads as | Evidence |
|---|---|---|
| `¿º`, `Ùº` | ন্তু, স্তু | কিন্তু ×7, প্রস্তুতি; `º` is to `¹` what ু is to the bare conjunct. |
| `¨` | ূ | ভূমি ×86; sits in the § ¨ © run, as ¤ ¥ ¦ is ু. |
| `õ` | ল্ল | উল্লেখিত, মোতাওয়াল্লি |
| `ý` | হু | রুহুল, হুমকি |
| `~` + ে | ৈ | জনৈক, জনৈকা, পৈত্রিক, plus the earlier রাজনৈতিক. Merged in `postProcess`, not tabled, so the length-ratio check keeps its floor of 1. |

### Raw source received — the rest resolved

The raw bytes of the whole plaint now convert with one flagged sequence, `t`. Three more rules, same tests file:

| Bytes | Now reads as | Evidence |
|---|---|---|
| `å` | ন্ধ | `Ae¤på¡−el` অনুসন্ধানের ×6. The other 2 uses (`fË¢aà¢åa¡`) give প্রতিদ্বন্ধিতা, most likely the document's own slip for প্রতিদ্বন্দ্বিতা; the converter reproduces what the bytes say. |
| `´` | ঙ্ | `f¤´M` পুঙ্খ (half form). The second পুঙ্খ in the raw has no ু byte, so it converts as পঙ্খ: a gap in the source. |
| `Õ` | শ্ | `¢e¢ÕQa` নিশ্চিত (half form, beside `Ö` = ষ্) |

The remaining `t` is a real Latin "t" in an English phrase. The plaint's English ("Successor-in interest", "Co-sharer in possession by lease or in any form", "Findings and decision") is converted into Bengali letters, because the same letters are valid in both. Pasted text has no font name to tell them apart, so this is not fixable by a rule; a DOCX or PDF with font runs avoids it. Open: a "this looks like English" warning, if wanted.

Superseded by the raw source above. From the log alone these were unknown: `Ó`, `»`, `ï`, `ñ`, `ë` and a bare `¹`; none of them occurs in the raw plaint.
- `å` is the one to watch: the two shown contexts need different values (প্রতিদ্বন্দ্বিতা wants ন্দ্ব, অনুসন্ধান wants ন্ধ), so it may be two bytes or a mis-copy. The 9 hidden occurrences and the raw bytes decide it.
- The log only showed 3 contexts per byte; the rest need the full list.
- Log 5's lone `¿` is probably the `¿º` pair above. Confirm against the raw text.

## 9. Update — two more logs (a lone `t`, and 430 unmapped), diagnostics built

Written for: the project owner. Code changed this pass: `engine/diagnose.ts` (new), plus three lines each in `pipeline.ts` and `classify.ts`. Tests: `__tests__/diagnose.test.ts` (written first; red because the module did not exist). Warning-only, so no engine-version bump (still 1.3.0).

### Log 6: `t` ×8 — `ভশ ভশ⟦t⟧নক্ষনড়t`

**Diagnosis: a missing alpha-ANSI slot, but the evidence cannot settle it.** `t` is the one byte `alphaAnsi/map.ts` leaves out on purpose. By slot position it is ঢ় (ড় = `s`, য় = `u`; the varnamala order is ড় ঢ় য়), the same kind of alignment that pinned `v x y`. But the surrounding text (`ভশ ভশ…নক্ষনড়`) is not a word in any reading, so the log cannot confirm ঢ় or reject ঃ (Bijoy's `t`).

**Decision: no rule added.** The project rule is two sources or a real document. **Needed:** the raw bytes of one real word containing `t` (for example আষাঢ়, দৃঢ়, গাঢ়).

### Log 7: 430 unmapped (`t ×268`, `# $ ‡ \` * _ ̄ @ + † ¿ | < ó ~ ^ Í ñ \ Á ß ã Ï Š ú`)

**Diagnosis: the wrong encoding was applied to some or all of the text.** Probed against the registry: **20 of the 26 distinct characters, and all of the top ones by count, are mapped by Bijoy** (`t ‡ † $ \` _ ¿ | ó ~ ^ Í ñ Á ß ã Ï Š ú \`). None is mapped by alpha-ANSI. The context windows also hold clean alpha-ANSI words (`খালাস`, `অালোচ্য`), so this is most likely a **document that mixes Bijoy and alpha-ANSI runs** pasted as one block. Mapping rules cannot fix that; picking the right encoding per run can.

### Built

| Item | What it does |
|---|---|
| `findForeignEncoding` (open item §7.5, log 3) | If at least 3 distinct unmapped bytes exist and another registered encoding maps at least 60% of the occurrences, the conversion warns `N of the M unmapped characters belong to Bijoy, not alpha-ANSI…`. A lone byte never triggers it (that is a missing rule, as in log 6). Classified `invalid_encoding`. |
| `looksLikeGlyphOrderText` (open item §7.3, log 4) | Warns `This text is glyph codes, not letters: the PDF's font has no text map… Read the pages with the OCR tool instead.` Fires on 20+ non-space characters with at most 20% letters, at least 50% ASCII punctuation and at least 6 distinct symbols. Negative tests: Bijoy prose, English, reference tables (`123/2020 Rs.5000/-`), dotted leaders, ruled lines. Classified `invalid_encoding`. |

The two are exclusive (the glyph-order message wins). The per-byte list and `unmappedDetails` are untouched, so `runConversion`, the failure reporter and the AI-resolution pipeline behave as before.

**Validation (from `convert2uni/`):** `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `npx vitest run` 151 files, 2554 tests, all passing; `npm run build` exit 0.

### Not done, and why

- **The OCR hand-off is wording only.** The warning names the OCR tool; there is no button or auto-route to `/ocr`. That is UI work in `ConversionWarnings.tsx` and needs your call (and a browser check, per the standing OCR rule).
- **The mixed-font case (log 7) needs the source.** For DOCX/PDF, font-aware conversion already splits runs by font. For pasted text there is no font name, so the hint is the most the engine can do.

### Updated open list (replaces §7 "Updated open list")

1. ~~Raw bytes of a `ঢ়` word for alpha-ANSI `t`~~ **Superseded by §10**: the `t`s in these logs are English letters. A `ঢ়` word is still needed to ever fill the slot, but nothing is blocked on it.
2. The raw source or font name behind logs 3 and 7: is it a mixed-font DOCX/PDF? If so, check the font-run path assigns each run the right encoding.
3. The PDF behind log 4, to confirm the missing-`ToUnicode` theory.
4. Raw bytes of `কিন্তু` from log 5 (probably fixed by `¿º`, §8; confirm).
5. ~~"No text map" guard~~ **Done**. ~~"These bytes belong to Bijoy" hint~~ **Done**.
6. Optional: make the glyph-order warning link to `/ocr` in the UI.
7. Other consonants may lack an `X¡` form. Add each from a real document.
8. Commit the working tree. Nothing is committed yet.
9. Decide §4 items 1 and 2.

## 10. Update — the raw source for logs 6 and 7 arrived

Written for: the project owner. No code changed. The source is a Bangladesh High Court judgment extracted from a PDF (customs / advance-tax case). I ran it through `convertLegacyText` with each registered encoding (probe file deleted afterwards).

### What the source is

One extraction mixes **five kinds of text**:

1. alpha-ANSI Bengali: `M¡m¡−pl`, `Evf¡ceL¡l£`, `A¡−m¡QÉ`, `fÐ¢œ2u¡Ll−Zl`.
2. Bijoy Bengali: `†Kvb wbewÜZ Drcv`bKvix`, `AvBb kã‡Kvl`, `cÖ ̄‘ZKib`.
3. English paragraphs and English terms inside Bengali lines (`Customs Act, 1969`, `Section 156`).
4. Glyph-code lines: runs of `# % ( ) * 7 &` with no letters (the missing-`ToUnicode` case, log 4).
5. Both Bengali encodings on **one line**: `j§j ̈ ms‡hvRb Ki J pÇf§lL öó`.

### Findings

- **`t` is an English letter, not a missing `ঢ়`.** alpha-ANSI maps every Latin letter to a Bengali glyph except `t`, so English `t` is the only English letter that shows up as unmapped. In the probe, **18 of 18** unmapped `t` sit inside English words (Section, Act, Customs, Table, Manufacturer, materials, components). Log 6's `t` ×8 and log 7's `t` ×268 are almost certainly the same thing. This **retracts** the §9 guess that `t` might be `ঢ়`; the no-rule decision stands, and the reason is now stronger.
- **Worse, the other English letters are not flagged at all.** `Section` converts to Bengali junk silently, because every letter except `t` has a Bengali mapping. The `t` warnings are the visible part of that.
- **The foreign-encoding hint is right on this source.** alpha-ANSI selected: `59 of the 70 unmapped characters belong to Bijoy Classic`. Bijoy selected: `150 of the 158 … belong to Legacy ANSI (alphabetic)`. Both name the real second encoding and say it may be a mixed document. `detectEncoding` picks alpha-ANSI (0.89 vs 0.48), which is the majority encoding.
- **Caveat on the hint's numbers:** English `t` is counted as a Bijoy byte (Bijoy maps `t`), so the 60% share is inflated in English-heavy text. The verdict here is still correct because real Bijoy bytes (`‡ \` _ $ ¿ † ̄`) are present.

### What this means

- **A single-encoding conversion of this document cannot be correct.** Whichever encoding is chosen, the other encoding's lines, the English lines and the glyph-code lines are wrong. No mapping rule changes that.
- **Fix path: per-run conversion by font.** The font-aware PDF path (per-font encoding, English fonts left alone) is the supported fix. The pasted text has lost the font names, so for pasted text the engine can only warn.
- **A line-level or word-level encoding splitter for pasted text** is possible (score each line against each encoding, skip English lines) but is a heuristic feature, not a bug fix. Mixed lines like item 5 would still be wrong. Not built; needs your decision.

### Open list (replaces §9)

1. Run this PDF through the font-aware path (upload, not paste) and check each run gets the right encoding. This is the real test of the fix.
2. Decide whether to build a heuristic line-level splitter for pasted mixed text (see above).
3. Optional: when the only unmapped sequence is an ASCII letter, say "this is probably English text inside a legacy document" instead of listing it as an unmapped byte.
4. The PDF behind log 4's glyph-order lines: this source has such lines too (item 4 above); confirm the font has no `ToUnicode`.
5. Raw bytes of `কিন্তু` from log 5 (probably fixed by `¿º`, §8).
6. Optional: link the glyph-order warning to `/ocr` in the UI.
7. Other consonants may lack an `X¡` form; add each from a real document.
8. Commit the working tree. Nothing is committed yet.
9. Decide §4 items 1 and 2.

### Update — Bijoy text converted as alpha-ANSI (430 unmapped, 357 Bijoy)

Same wrong-table failure as log 3. Auto-detect scores a Bijoy passage Bijoy 0.97 / alpha-ANSI 0.33, so the table was chosen by hand. Bijoy maps every listed byte except `# * @ + <`, whose meaning needs the source text before any rule is added. Fix: `ValidationResult.suggestedEncodingId`, plus a "Convert as Bijoy Classic" button on the paste converter. The document-upload panel gets no button, since it picks fonts per run.
