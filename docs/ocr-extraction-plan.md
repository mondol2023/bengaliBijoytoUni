# OCR Extraction page (`/ocr`) — plan


## 1. Context

Convert2Uni converts legacy-font *text layers* (Bijoy/SutonnyMJ) to Unicode. It cannot read text that is **pixels**: images embedded in PDFs/DOCX, or PDF pages drawn as pictures. Memory notes show the real corpus has this (a court PDF scored 10% quality; its Bengali lines are images). Today the only recourse is `/api/ai/transcribe`, which sends the **whole PDF** to Gemini, returns one undifferentiated blob, never looks at images in DOCX, and draws on the shared 100-calls/day AI budget.

Goal: a **separate `/ocr` page** that finds text locked in images, with per-image / per-page results, free local OCR first and Gemini only as a signed-in fallback.

### Decisions already made (yours)
| Topic | Decision |
|---|---|
| Engine | **Hybrid**: Tesseract first, Gemini when confidence is low |
| Scope | **Both modes with a toggle**: *Embedded images* (default) and *Whole pages* |
| Inputs | **PDF and DOCX only** (no standalone PNG/JPG) |
| Handoff | **"Open in Compare"** (not "Send to Converter" — OCR output is already Unicode; see §3) |
| Gemini access | **Signed-in users only**; anonymous = Tesseract only |

### Assumptions I'm making (correct me)
- Tesseract runs **in the browser** (tesseract.js + self-hosted `ben`/`eng` data). Reason: no server canvas dependency, no Vercel timeout/body limits for the free path, and the file never leaves the device on the free path.
- "Auto-improve with Gemini" is a **per-job checkbox, default ON for signed-in users**, plus a manual per-item "Retry with Gemini". Only the *low-confidence image crops* are uploaded, never the whole file, with a disclosure line.
- `OCR_GEMINI_ENABLED` flag, **off by default**, matching `AI_TRANSCRIPTION_ENABLED`.
- Gemini gets its **own daily budget** so it can't starve the existing features.

## 2. Architecture

```
Browser                                              Server (Vercel, nodejs)
───────                                              ───────────────────────
OcrWorkspace ─ useOcrJob ─ features/ocr/orchestrator
   │                           │
   │  extract/pdfImages | pdfPages | docxImages   (pdfjs-dist, JSZip — client)
   │  filter + dedupe + order → OcrItem[]
   │                           ▼
   │                  engine/tesseract (worker pool ≤2, ben+eng)
   │                           ▼
   │             confidence.ts: keep, or flag for fallback
   │                           ▼  (signed-in + toggle + consent)
   └──────── POST /api/ocr/gemini  (≤N downscaled crops, Bearer token) ──► lib/ai/ocrImages.ts ─► registry ─► providers/gemini
                                                              requireServerUser · checkSharedRateLimit · lib/ocr/budget.ts (own counter)
```

### New files (all additive)
```
app/ocr/page.tsx                         thin: metadata + <OcrWorkspace/>
app/api/ocr/gemini/route.ts              auth, rate-limit, budget, size guards; failResponder("api/ocr/gemini")
components/ocr/OcrWorkspace.tsx          page body, modeled on DocumentUploadWorkspace
components/ocr/{OcrDropzone,ModeToggle,OcrProgress,OcrItemCard,OcrSummaryBar}.tsx
hooks/useOcrJob.ts                       thin React wrapper (state, cancel, stale-result guard)
features/ocr/
  types.ts config.ts postprocess.ts
  extract/{pdfImages,pdfPages,docxImages,filter}.ts
  engine/{tesseract,confidence,orchestrator}.ts
  __tests__/…
lib/ai/ocrImages.ts                      server: image(s) → text via the Gemini provider
lib/ocr/budget.ts                        own daily counter (does NOT touch costCap.ts)
lib/ai/ocrPrompt.ts                      versioned prompt (ocr-v1)
scripts/ocr-sync.mjs  (+ npm run ocr:sync)   copies worker/wasm/traineddata/pdf.worker to public/ (same pattern as dict:sync)
```
Rules: `features/ocr` is pure/isomorphic where possible, **never imports `lib/ai`**, and returns `Result<T, AppError>` per the project error model. No new `AppErrorCode` unless needed.

### Extraction details
- **PDF – embedded images mode:** pdfjs-dist `getOperatorList` → `paintImageXObject` → decode to canvas. Skip decorative/tiny images (< ~48 px side or < ~3 000 px² area), dedupe by content hash (logos repeated every page), keep page + position order.
- **PDF – whole-page mode:** render each page to canvas at ~2× (cap pixel count), page cap (start at 30).
- **DOCX:** open as zip (JSZip, already a transitive dep of mammoth — declare explicitly), read `word/media/*`, order by relationships in `document.xml`, same filter/dedupe.
- Native selectable text is **not** re-OCR'd; page header links to `/documents` for that.
- Hard caps in `config.ts`: file size (reuse the 15 MB limit), max items, max pages, per-item max pixels. Exceeding a cap returns a clear user-safe error, never a hang.

### Confidence → fallback (`confidence.ts`)
Fallback when: mean Tesseract confidence < threshold, **or** Bengali-script ratio too low for an image that looked Bengali, **or** empty output on a non-trivial image. **Threshold is set from measured data in the Phase 0 spike, not guessed.**

### Gemini route constraints
- Crops downscaled (≤ ~2000 px long edge) and batched so request bodies stay well under Vercel's ~4.5 MB function limit (verify at implementation).
- Per-job cap on items sent; `maxDuration` like the transcribe route; no retries; fail-closed budget.
- Output labelled "AI output"; ocr prompt = faithful transcription, no translation/summary, `[অস্পষ্ট]` for unreadable (consistent with `transcribe-v1`).

## 3. "Open in Compare" and why not "Send to Converter"
OCR reads rendered glyph shapes, so Bijoy-typed text in an image comes back as real Unicode Bengali — there is no legacy gibberish to convert. Legacy gibberish only exists in a PDF's *text layer*, which `/documents` already handles. Compare is the useful next step (verify OCR vs a reference). Implementation: write text to `sessionStorage["c2u:compare-prefill"]`, navigate to `/compare`, and let the Compare side-A input read-and-clear it once on mount. **This is the only edit to an existing page's behavior, so it is its own last phase.**

## 4. "Nothing should break" — isolation contract
Existing files touched (each tiny, additive, listed so review is trivial):
| File | Change | Risk control |
|---|---|---|
| `components/layout/SiteHeader.tsx` | add one `<Link href="/ocr">` | 4 links on small screens is tight (no mobile menu exists) → visual check at 360 px; shorten label to "OCR" |
| `components/layout/SiteFooter.tsx` | add to links array | trivial |
| `next.config.ts` | CSP for `/ocr` only: `worker-src 'self' blob:`, `'wasm-unsafe-eval'`, `img-src … blob:` | Global CSP rule gets a `source` that **excludes** `/ocr`, plus a separate `/ocr` rule (two CSP headers would intersect, so relaxing "on top" wouldn't work). Verify all other routes' headers unchanged |
| `lib/ai/registry.ts` | add `getOcrProvider()` | existing exports untouched |
| `lib/ai/__tests__/callSites.test.ts` | extend allowlists: registry importers += `ocrImages.ts`; route importers += `app/api/ocr/gemini/route.ts` | **Deliberate** guard update; the "conversion path never imports lib/ai" rule stays intact and `features/ocr` is outside conversion roots |
| `package.json` | add `tesseract.js`, `pdfjs-dist`, `jszip` | pin versions; confirm `npm run build` stays clean, no `serverExternalPackages` (per CLAUDE.md) |
| `.env.local.example` | `OCR_GEMINI_ENABLED`, `OCR_GEMINI_DAILY_CALL_BUDGET`, optional model | documentation only |
| Compare input (Phase 7) | one-time prefill read | additive; skipped entirely if key absent |

Untouched: converter engine, encodings, `features/documents`, `app/api/documents`, `lib/ai/costCap.ts`, `/api/ai/transcribe`.

## 5. Phases (project's standing rule: one phase → validate → report → pause for go-ahead)
Validation bar every phase: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

0. **Spike + doc (read-only on app code).** Copy this plan into `docs/ocr-extraction-plan.md`. Pull ~15 image-text samples from the Downloads court-PDF corpus + a few synthetic DOCX/PDF, run tesseract (`ben`, `ben+eng`, fast vs best data) vs Gemini offline, record CER/confidence. **Gate:** if Tesseract Bengali is too weak to be useful, we say so and re-scope (e.g. Gemini-primary for Bengali) before building the UI.
1. **Pure logic + tests:** types, config, filter/dedupe, ordering, confidence decision, postprocess (NFC/whitespace).
2. **Extraction:** pdfImages, pdfPages, docxImages with generated fixtures.
3. **Engine:** tesseract wrapper, orchestrator (concurrency, cancel, progress), `ocr:sync`, `/ocr`-scoped CSP.
4. **UI:** `/ocr` page, hook, components (not yet linked in nav).
5. **Gemini fallback:** `lib/ai/ocrImages.ts`, budget, route + route tests, registry + guard-test update, UI wiring (signed-in gating, consent, per-item retry).
6. **Wire-up:** header + footer links, home-page mention if appropriate.
7. **Open in Compare:** sessionStorage prefill.
8. **QA pass + docs:** full checklist below; update `CLAUDE.md`/`README.md` with the gotchas.

## 6. UX / design notes
- Reuse `ToolHead`, `tool-plate`, `sheet`, `Button`, `Badge`, `Progress` (Radix), `PrivacyNote`, `CopyButton`, `downloadTextFile`, motion tokens + reduced-motion hook; follow `DESIGN.md`.
- Layout: dropzone → mode toggle (*Embedded images* / *Whole pages*) + "Auto-improve with Gemini" (disabled with hint when signed out) → progress with item counts and Cancel → result list: **thumbnail beside text**, page/image label, confidence badge, engine badge (Tesseract / Gemini · "AI output"), copy, "Retry with Gemini".
- Summary bar: Copy all, Download `.txt`, Open in Compare.
- Bengali results: `font-bengali` + `lang="bn"` (per item, by script ratio); results region `role="region"` + `aria-live="polite"`.
- States: empty, extracting, OCR running (per-item), partial failure (keep good items), nothing found ("no images with text — try Whole pages" / link to Documents), cap exceeded, offline/wasm load failure, Gemini unavailable.
- First-use download of Tesseract data (~MBs): show it explicitly, cache via the browser, lazy `import()` so no other page's bundle grows.

## 7. QA plan
- **Unit (vitest):** filter/dedupe/order, DOCX relationship ordering, confidence decision table, postprocess, budget counter, route (mock `requireServerUser`, rate limit, provider like existing `route.test.ts`): 401 anonymous, 429, flag off, oversize, budget exhausted, success, provider error never leaks `debug`.
- **Guard:** `callSites.test.ts` passes with the intentional allowlist edits and still fails if `features/ocr` or the conversion path imports `lib/ai` wrongly.
- **Fixtures:** generated PDF/DOCX with embedded Bengali image, repeated logo (dedupe), tiny icons (filtered), image-only scanned page, password-protected/corrupt files, 0-image file.
- **Real-world:** the Downloads court PDF with image-drawn Bengali lines.
- **E2E (Playwright, `tests/`):** upload fixture → results appear → copy/download → Open in Compare prefill; anonymous shows Gemini disabled.
- **Regression:** `/`, `/converter`, `/documents`, `/compare` load and headers/CSP unchanged (assert in a test or manual diff of response headers); bundle-size check that other routes didn't grow.
- **Manual:** 360 px nav, keyboard-only flow, screen-reader labels, dark mode, slow network, 15 MB PDF memory behavior, cancel mid-run.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Tesseract Bengali accuracy poor on conjuncts/low-res | Phase 0 gate; data-driven threshold; Gemini fallback; show confidence honestly |
| pdfjs-dist worker + Turbopack bundling quirks | self-host worker via `ocr:sync`; verify in `npm run build`, not just dev |
| CSP relaxation leaking to other routes | path-scoped rule; header regression check |
| Large PDFs exhaust browser memory | page/pixel/item caps, sequential decode, free canvases/bitmaps |
| Vercel 4.5 MB body limit on Gemini route | downscale + batch; verify actual limit |
| Cost abuse | signed-in only, rate limit, per-job cap, separate daily budget, flag off by default |
| Privacy | free path is local; Gemini upload only for flagged crops, explicit disclosure via `PrivacyNote`/`lib/privacy/disclosure.ts` |

## 9. Execution prompt (to start each phase)
> You are working in `convert2uni/` (Next.js 16, React 19, TS, Tailwind 4). Read `CLAUDE.md`, `PROGRESS.md`, `DESIGN.md` and `docs/ocr-extraction-plan.md` first. Implement **only Phase N** of the OCR plan. Constraints: everything lives in the new files listed in §2; touch existing files only as listed in §4; never import `lib/ai` from `features/**`; use `Result<T, AppError>` and `failResponder`; match surrounding code style and comment density; Bengali output uses `font-bengali` + `lang="bn"`. Write tests first for pure logic. Finish by running `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`, report results plus any deviation from the plan, then **stop and wait for approval** before the next phase. Do not commit unless asked.

## 10. Verification of this plan's delivery
After Phase 8: all four commands green; `/ocr` works end to end on the Downloads court PDF and a DOCX with embedded images, signed-out (Tesseract only) and signed-in (with Gemini fallback, flag on, staging key); other routes behave and carry identical headers to before.

## 11. Phase 0 results (2026-10-07) — gate: **PASS for Bengali printed/rendered text; fallback is essential for photos**

Spike ran in a scratch dir outside the repo (tesseract.js 7.0.0, pdfjs-dist, @napi-rs/canvas); no app code touched.

### Method and honest limits
- 25 samples: real court-PDF image text (stitched lines, single strips, whole pages), a designed Bengali cover page, a CamScanner photo scan (English + Bengali footer), a photographed trade licence (small Bengali form text), and 8 synthetic renders with exact truth (clean / 20 px / low-res / tilt+noise).
- The Downloads corpus is now 27 PDFs (the ~402 in earlier notes are gone); only 2 court PDFs draw Bengali as images.
- **Ground truth is thin:** no PDF has a Unicode Bengali text layer, so truth is my own reading of 3 court lines + 5 cover lines + 4 licence/scan lines, plus the synthetic strings. CER is *semi-global recall* (best-matching substring of the output for each truth line), so extra junk outside the matched span is not penalised. Treat figures as indicative, not a benchmark.
- Only **2 hard real-world samples** (licence photo, CamScanner) → any threshold is provisional.

### Tesseract (CER on Bengali-truth samples, n=15; mean ms per image in Node)
| Data | mean CER | max CER | mean conf | time |
|---|---|---|---|---|
| `ben` fast | 1.4 % | 7 % | 88 | 0.30 s |
| **`ben` best_int** | **0.7 %** | 2 % | 91 | 0.53 s |
| `ben+eng` fast | 2.2 % | 8 % | 88 | 0.56 s |
| `ben+eng` best_int | 2.0 % | 10 % | 91 | 0.90 s |

Hard samples (best_int): CamScanner English article **`ben` only → 84 % CER, conf 38**; `ben+eng` → 7 %, conf 90. Licence photo → 26 % CER, conf 76–79 either way.

### Findings that change the plan
1. **Use `best_int`, not float `best`.** `tessdata_best` crashes the tesseract.js WASM core (`missing function DotProductSSE`, every core variant/OEM). Integer-quantised `4.0.0_best_int` works and beats `fast` (fast drops conjuncts, e.g. `স্বত্ব`→`স্ব`). Sizes: `ben` 1.3 MB, `eng` 2.9 MB gzipped. `ocr:sync` should copy them from the npm packages `@tesseract.js-data/ben` / `@tesseract.js-data/eng` (`4.0.0_best_int/`), not a CDN.
2. **Do not default to `ben+eng`.** On Bengali pages it is *worse* (injects Latin garbage: `৪নং`→`87`, `পুনর্বিন্যস্ত`→`SITE`). **But `ben` alone is useless on English.** Plan: run `ben` first; if mean confidence < ~60 (English page scored 38) re-run with `ben+eng`; the second-pass result replaces the first only if its confidence is higher.
3. **Provisional fallback threshold: mean confidence < 82** (good samples were all ≥ 88; licence photo 76; English-through-`ben` 38). The 76–88 gap is where more hard samples are needed. Capture **per-word confidence** in the engine wrapper (Phase 3) so the rule can be "fraction of words below 70" instead of one mean.
4. **Embedded-images mode must stitch strips first.** Court PDFs draw each line as 3–10 overlapping fragments (~138 px tall, 60–3500 px wide, ~60 per page, some are a lone hyphen). OCR of stitched same-row lines: 0–1 % CER. A lone hyphen strip OCR'd to `জ্্্` (conf 22) — so `filter.ts` needs row-grouping (same y ±6 pt, ordered by x) before OCR and a minimum-glyph-area rule. Whole-page mode at 2× (1224 px wide) was as good as 3× (≈1 % CER), so cap page renders near 2×.
5. **Known Tesseract weakness: digits and some conjuncts** — `৪নং`→`8৪নং`, `ভূ`→`ভু`, `অ্যা`→`আ্যা`, `র্ব`→`ব্ব`. Court documents are number-heavy, so the UI must label OCR output "verify numbers" and the Gemini retry is most valuable there.
6. **Image fidelity matters more than engine choice:** clean rendered Bengali is ~1 %; photographed forms are ~25 %. This is where the fallback earns its place.

### Gemini findings (partial — see "Provider chain" below)
- The repo default `gemini-2.5-flash` now returns **404 "no longer available to new users"** for the project's key. This also affects the existing `/api/ai/transcribe` route and `GEMINI_TRANSCRIPTION_MODEL` default — separate bug, not fixed here.
- Available models differ wildly in reliability today: `gemini-3.8-flash` 22–490 s per call (timeouts); `gemini-flash-latest`/`gemini-3.1-flash-lite` 503 "high demand"; `gemini-3.5-flash` 8–14 s per line and **0 % CER on the 6 samples it completed**; `gemini-3.5-flash-lite` 2.6 s but a conjunct slip (`আপী্ল্যান্ট`).
- The key hit its **free-tier quota (HTTP 429) after ~25 calls**, so whole pages, the cover, the licence and the English scan have **no Gemini numbers**. The spike used the project's key — quota was shared with the app.
- Consequence: Gemini alone is too flaky/slow to be the only fallback → provider chain.

### Provider chain (user request, 2026-10-07: "add other free AI agents alongside Gemini")
- The fallback becomes an ordered list of vision providers behind the existing `lib/ai/registry.ts` (it already abstracts Gemini/OpenAI). Route tries the next provider only on 429/5xx/timeout (short per-provider timeout, e.g. 25 s) and never silently — the result records which provider answered, shown in the engine badge.
- Candidates worth benchmarking if keys are available (free-tier terms **not verified** — check before committing): Mistral OCR, Google Cloud Vision, OpenRouter free vision models, Groq-hosted Llama vision, Cloudflare Workers AI. Each needs the same 25-sample run; Bengali conjunct/digit accuracy is the criterion.
- Each provider gets its own flag/key/budget (like `OCR_GEMINI_*`); anonymous users stay Tesseract-only.

### Revised before Phase 1
- §2 confidence: initial rule = mean conf < 82 OR (conf < 60 → retry with `eng`); per-word conf captured.
- §2 extraction: add row-stitching to `filter.ts`; page render cap ≈ 2×.
- §2 files: add `lib/ai/ocrProviders.ts` (ordered chain) instead of a single `ocrImages.ts` provider call; `ocr:sync` sources `best_int` from npm.
- New open item: Gemini model default (`gemini-2.5-flash` → 404) must be resolved before Phase 5; pin a working model via env, don't hard-code.

## 12. Phase 1 status (2026-10-07) — done, uncommitted

Pure logic + 55 tests in `features/ocr/`: `types.ts`, `config.ts` (caps, thresholds, `pageRenderScale`, `checkPageCap`/`checkItemCap`), `postprocess.ts` (NFC/whitespace, `bengaliRatio`), `engine/confidence.ts` (English retry, pick-better, fallback decision), `extract/filter.ts` (decorative filter, dedupe, row grouping, `planEmbeddedRows` / `planUnplacedImages`). `tsc`, `lint`, full `vitest` (2125 tests) and `build` are green. No existing file was edited.

Deviations / decisions worth knowing:
- **Dedupe is hash + position, not hash alone** for PDFs. The same glyph strip can recur inside one text line, so a hash-only dedupe would delete real text; a logo repeated at the same spot on each page is still removed. DOCX (no positions) dedupes by hash.
- **Row grouping compares to the row's first fragment**, not the previous one, so small steps can't drift a row down the page.
- **Lone-hyphen rule = minimum stitched-row area (`OCR_MIN_ROW_AREA_PX`, 12 000 px²), provisional.** The spike didn't record the hyphen strip's size; recalibrate against real stitched rows in Phase 2. Known cost: a lone page number drawn as its own tiny row (~70 × 138 px) is dropped.
- The "Bengali-script ratio" fallback reason from §2 was dropped in favour of the §11 revised rule (confidence + empty output only). `bengaliRatio` exists for the UI's per-item `lang="bn"`.
- DOCX relationship ordering is left to Phase 2 (`docxImages.ts`), since it needs the zip/XML.

## 13. Phase 2 status (2026-10-07) — done, uncommitted

Extraction layer + 58 new tests in `features/ocr/`: `extract/openPdf.ts`, `pdfImages.ts` (`scanPdfImages`, `createRowRenderer`), `pdfPages.ts` (`renderPdfPage`), `docxImages.ts` (`listDocxImages`, `decodeDocxImage`), `pixels.ts` (RGBA conversion, hash, `stitchRow`), `imageSize.ts`, `canvas.ts` (injected `CanvasEnv` interfaces only). Test fixtures are generated (`__tests__/helpers/pdfFixture.ts` builds PDFs with Flate image XObjects; DOCX built with JSZip). New deps: `pdfjs-dist` 6.4.299, `jszip` 3.10.2, dev `@napi-rs/canvas` 1.0.10. `tsc`, `lint`, full `vitest` (2183 tests) and `build` are green; no existing app file was edited and no route's bundle changed (pdf.js/JSZip are lazy `import()`s in modules nothing imports yet).

Design decisions / deviations:
- **Two-stage PDF extraction.** `scanPdfImages` walks each page's operator list tracking the CTM and records placement, pixel size and a hash, then drops the pixels; `createRowRenderer` re-fetches only the rows `planEmbeddedRows` kept, one page at a time. A 30-page scanned court PDF therefore never sits in memory as decoded pixels.
- **The pdf.js `OPS` table is carried on `OpenPdf`** (codes differ per build, and tests use the legacy build). pdf.js 6 has no `isEvalSupported` option, so it is not passed. Image objects resolve asynchronously, so `resolveImageObject` waits on the callback form of `objs.get` with a 10 s timeout.
- **Unreadable images are counted, not hidden:** masks, the grouped/repeat paint operators, oversize (> `OCR_MAX_ITEM_PIXELS`) and malformed buffers go in `unreadable` so the UI can say so.
- **DOCX:** references are read from `word/document.xml` in document order (`<a:blip r:embed>`, `<v:imagedata r:id>`), rels resolved from `word/_rels/document.xml.rels` (external links skipped), sizes read from headers only (PNG/GIF/BMP/JPEG), hash by content. Zip-bomb guard: an entry whose declared size exceeds `OCR_MAX_FILE_BYTES` is never inflated. Mutation-checked: with the guard removed, the test's worker runs out of heap.
- Browser canvas (`browserCanvasEnv`) is **not** written yet; it lands with the engine in Phase 3. The JPEG path (`ImageBitmap` → pixels) is covered only through `bitmapToRgba`, so it needs a real-browser check in Phase 3/4.
- `RowRenderer` re-reads the page's operator list when it changes page, so rows should be processed in page order.

Real-corpus check (~/Downloads, scratch script, deleted): 4 court/CamScanner variants scan in 1–3 s each. The fragmented court PDF: 514 images → 211 rows (14 duplicates and 14 tiny rows dropped), 5-fragment lines stitch into clean single Bengali lines (visually verified). The one-image-per-page variants give 9 rows of 1275×2101; CamScanner PDFs give 4 page scans plus a 234×234 px / 22 pt logo per page (deduped to 1 row, so one throw-away OCR call per file).
- **`OCR_MIN_ROW_AREA_PX` = 12 000 kept**: it only dropped the 14 genuinely tiny rows; no calibration change.
- Open: the CamScanner logo survives as a row. A rule on *placed* size (< ~30 pt on both sides) would drop it; deferred to Phase 3 where the engine's confidence/empty-output rule already discards it cheaply.

## 14. Phase 3 status (2026-10-07) — done, committed in `44493db`

Engine + runtime hosting + `/ocr`-scoped CSP, with 52 new tests (suite: 133 files / 2235 tests). `npx tsc --noEmit`, `npm run lint`, `npx vitest run` and `npm run build` are green; no route was added or changed in the build output. New deps (pinned): `tesseract.js` 7.0.0, dev `@tesseract.js-data/ben` 1.0.0 and `@tesseract.js-data/eng` 1.0.0.

New files: `engine/bmp.ts` (`encodeBmp`), `engine/tesseract.ts` (`createOcrEngine`: per-language worker pool), `engine/tesseractWorker.ts` (`createTesseractWorkerFactory`, `wordsFromBlocks`, `BROWSER_TESSERACT_LOCATION`), `engine/orchestrator.ts` (`runOcrJob`), `extract/browserCanvas.ts` (`browserCanvasEnv`), `scripts/ocr-sync.mjs`. Edited: `config.ts` (+`OCR_WORKER_POOL_SIZE`), `next.config.ts`, `package.json`, `.gitignore`, `eslint.config.mjs`.

Design decisions / deviations:
- **Image bytes are BMP.** tesseract.js's browser build takes encoded bytes, not `ImageData`. A 24-bit BMP is ~30 lines of pure TS (transparency flattened onto white), needs no canvas, and runs identically in vitest and the browser — so the engine is tested against *real* Tesseract in Node (`tesseractWorker.test.ts`: English through `ben+eng`, blank image, missing data).
- **Worker pool is per language, lazy, max 2** (`OCR_WORKER_POOL_SIZE`). `ben` starts first; `ben+eng` workers exist only if some image needed the English retry. A worker whose pass threw is terminated and replaced (a WASM abort leaves it dead). `dispose()` also terminates a worker that finishes starting afterwards.
- **`runOcrJob` decodes images one at a time, in order, but recognizes in parallel.** `RowRenderer` re-reads a page's operator list on every page change, so interleaved loads would thrash it. It calls `engine.warmUp("ben")` first so a failed download/WASM load aborts the job once instead of failing every item. Partial failure keeps good items; an image the decoder can't read is `unreadable`, not `failed`. A failed English retry keeps the first pass. Cancel (`AbortSignal`) stops taking new items; in-flight recognitions finish (~0.5 s) and are returned with `cancelled: true`.
- **tesseract.js failure path is broken upstream, and handled.** If language data or the core fails to load, `createWorker` rethrows inside a message handler (an uncaught error) and *never settles* — it would hang the page on "loading". The factory passes an `errorHandler` and races it against creation. Found by a test (it hung for 60 s before the fix); the half-started worker is unreachable and left to be collected.
- **Runtime is self-hosted via `ocr:sync` → `public/ocr/`** (worker, three `*-lstm.wasm.js` cores, `ben`/`eng` `best_int` data, pdf.js worker; ~17 MB). Unlike `dict:sync` it is **gitignored and rebuilt by `predev`/`prebuild`** (a repeat run copies nothing), because committing ~15 MB of binaries seemed worse than a build step. Say so if you'd rather commit it. ESLint ignores `public/ocr/**` (minified vendor files produced 2 700 problems).
- **CSP is split, not layered.** The global rule's `source` now excludes `/ocr` and `/ocr/*` (`/:path((?!ocr(?:/|$)).*)` — `/ocrfoo` stays strict), and `/ocr/:path*` carries its own policy with `'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `img-src … blob:`. `csp.test.ts` runs the rules through Next's own matcher; I also diffed the pre/post `headers()` output (identical for the strict rule, dictionaries rule untouched) and curled a production `next start`: `/`, `/documents`, `/ocrfoo` strict; `/ocr`, `/ocr/lang/*`, `/ocr/core/*`, `/ocr/worker.min.js` relaxed, one CSP header each. `/ocr/:path+` also gets the dictionaries' `Cache-Control` (1 day + 7 days SWR).
- tesseract.js is created with `workerBlobURL: false` (same-origin worker, so the page doesn't actually need `blob:` for it); `blob:` is kept in `worker-src`/`img-src` per the plan for crop thumbnails.

Not verified (needs a real browser, i.e. Phase 4): `tesseractWorker.ts` through Turbopack/Next's client bundler (nothing imports it yet, so `next build` hasn't compiled it); the browser-side worker/core/IndexedDB-cache path; `browserCanvasEnv.decodeImage` on a real JPEG. The CamScanner-logo "throw-away row" from §13 is still handled only by the confidence/empty-output rule.

### Phase 3 hardening pass (2026-10-07) — uncommitted

Status check first: `tsc`, `lint`, `vitest` (133 files / 2235 tests) and `build` were all green; the only stale item was this section's "uncommitted" (Phase 3 landed in `44493db`). The review then found one real bug and several soft spots, all fixed test-first; suite now 133 files / **2250 tests**, all four commands green.

- **Bug: a cancelled job could hang forever.** tesseract.js's `terminate()` kills the worker but never rejects its pending job (both Node and browser adapters), and a worker crash (`onerror`) only rejects the *start* promise. So `dispose()` during a pass, or a mid-pass WASM abort/OOM kill, left `engine.recognize` — and so `runOcrJob` — pending for good. Every start and pass in `tesseract.ts` now goes through `settle()`, which races it against a timeout and `dispose()`. Proven against real Tesseract (`tesseractWorker.test.ts` "cut off by dispose"): with the fix removed the test hangs to its 60 s timeout.
- **Timeouts** (`config.ts`, *provisional*): `OCR_WORKER_START_TIMEOUT_MS` 120 s (first use downloads ~6 MB), `OCR_RECOGNIZE_TIMEOUT_MS` 90 s. A timed-out pass discards and terminates its worker ("This image took too long to read."); a start that turns up after its timeout or after dispose is terminated instead of leaked.
- **Start circuit breaker** (`OCR_WORKER_START_ATTEMPTS` = 2): after two consecutive start failures for a language, calls fail fast (live workers are still used). Without it, a broken `ben+eng` download made *each* low-confidence item wait out its own start and left one half-started Worker behind per item — the factory can't terminate a worker whose start failed (§14 above). A successful start resets the count.
- **Input validation before a worker is spent:** non-integer/zero size, buffer length ≠ w·h·4, or over `OCR_MAX_ITEM_PIXELS` → "This image could not be read." with the reason in `debug`. Extraction already caps rows/pages under that, so it is an invariant check, not a new limit.
- **Output sanitised:** non-string text → `""`, confidence NaN/out of range → clamped to 0..100, malformed words dropped, so `confidence.ts` rules always see their documented ranges.
- **Orchestrator:** a throwing `onItem` (e.g. a UI bug) no longer rejects `runOcrJob` while other workers keep running; an engine that throws instead of returning a `Result` fails that one item; a throwing `warmUp` becomes an error result. After a cancel, a *failed* outcome is treated as unfinished (it is almost always the dispose cutting the pass off), so the UI won't show "failed" cards for items the user stopped.

Still open (needs Phase 4's real browser): the start/recognize timeouts are not tuned on a slow phone; the half-started worker after a start *failure* is still unreachable (bounded to `OCR_WORKER_START_ATTEMPTS` per language per job now).

## 15. Phase 4 status (2026-10-09) — done, uncommitted

The `/ocr` page ("Scanner bed" design) on top of the Phase 1-3 engine. `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (141 files / 2393 tests) and `npm run build` are green; `/ocr` is a static route in the build output. New browser smoke test `tests/ocr.spec.ts` (Playwright; builds a picture-of-text PDF, reads it in Whole pages mode, checks Copy all and the `.ocr.txt` download, fails on any console error or CSP violation) passes on chromium, firefox and webkit against a production `next start` (chromium also against `next dev`).

Built: pure job modules in `features/ocr/job/` (`fileKind`, `source`, `jobState`, `view`, `browserRuntime`), `hooks/useOcrJob.ts`, `components/ocr/*`, `app/ocr/page.tsx`, the `OCR_NOTE` privacy line in `lib/privacy/disclosure.ts`. `features/**` does not import `lib/ai`; the `/ocr` route is 312 KB of client JS (pdf.js and Tesseract are lazy, loaded on first use), and the other routes moved by only 143-723 B against the Step 0 baseline (the additive `label` / `aria-label` props on `CopyButton` and `Progress`).

Deviations / decisions:
- **`OcrResultRow` instead of `OcrItemCard`**, and **no `aria-live` results region**: a long run would announce every row; the summary bar's marker is the live status.
- **pdf.js decoder hosting under `/ocr/pdfjs/`** (synced with the rest of `public/ocr/`); the pdf.js option names were confirmed in Task 1.
- **An error ends in "Stopped · N read"**, the same wording as a cancel (`view.test.ts` locks it); the alert above it carries the reason.
- Whole pages mode is offered from "nothing found" as "Read whole pages". The file input and Start over are disabled while a job runs, so a second file cannot start mid-run.

Two bugs only a real browser could show, both fixed test-first:
- **Shared page proxy race.** `renderBedPreview` called `page.cleanup()` on the proxy the row renderer was using; pdf.js then dropped `page.objs`, so the next row waited out the 10 s `IMAGE_WAIT_MS`, and the 211-line court PDF crawled at ~10 s/line. The preview no longer cleans up (`source.test.ts` "keeps reading rows on a page whose preview was rendered"). Now ~60 s.
- **JPEG pages failed as "corrupted".** pdf.js 6 hands Chromium a WebCodecs `VideoFrame` (no `width`/`height`) as `image.bitmap`, so `getImageData` threw. `bitmapToRgba` now takes the size from the image object (`pixels.test.ts`). CamScanner PDFs read.

Measured (this machine, headless chromium): court PDF, 211 lines ≈ 60-65 s (dev); CamScanner PDF, 5 rows, 69 s dev / 83 s prod; DOCX, 2 images, 2.1 s dev / 2.3 s prod; 12-page PDF in Whole pages mode ≈ 79 s (dev); cancel mid-run settles in 0.8 s and keeps the rows read; blocked `/ocr/lang/*` shows the error in 1.3 s; a second visit makes 0 `traineddata` requests (IndexedDB cache); smoke test 5-7 s. Two OCR runs at once roughly double a run's time, so time one at a time.

Checked at 360 px (headless): nothing inside `<main>` overflows, in light and dark; the first Tab stop is Start over.

Open items:
- **Site header overflows at 360 px** (131 px, identical on `/`, `/compare`, `/documents`; not from `/ocr`). Pre-existing, left alone.
- **WebKit blocks Firebase auth's `apis.google.com` loader** under the site-wide CSP on every route; the smoke test filters it.
- Tesseract's core prints "Image too small to scale!!" / "Line cannot be recognized!!" to the console for strips under 3 px wide (CamScanner logo, tiny rows). Harmless, the rows come back empty; not filtered in the test because the test PDF does not trigger it.
- Not verified: a real touch device, a screen-reader pass, reduced-motion behaviour (only the layout was checked with it emulated), scroll smoothness and blob-URL cleanup on the 211-row result, and the start/recognize timeouts on a slow phone (still provisional from §14).
- Phase 5 (provider fallback for low-confidence rows) is not started; the Gemini model default from §11 still needs resolving first.

## 16. Phase 5 status (2026-10-10) — built, **live signed-in proof not done**, uncommitted

Signed-in users can have low-confidence lines re-read by Gemini, automatically after a job or per line. `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (144 files / 2457 tests) and `npm run build` are green. The build lists `/api/ocr/improve` (dynamic).

Built (plan `docs/superpowers/plans/2026-10-08-ocr-phase5-ai-fallback.md`, Tasks 1–9): `route → lib/ai/ocrImages.ts → registry → providers/gemini.ts` (one `geminiOcrProvider`), per-provider daily call budget (`lib/ocr/budget.ts`, collection `ocrCallBudget`), index-keyed JSON answer parser, `GET`/`POST /api/ocr/improve`; browser side `features/ocr/fallback/{batching,improveClient,improvePass}.ts`, the `improving` phase and `improvements` overlay in `jobState.ts`, improvement-aware `view.ts`, `OcrImproveToggle`, and the AI states of `OcrResultRow` / `OcrSummaryBar` / `OcrProgress` / `OcrScannerBed` / `OcrWorkspace`.

Deviations (all settled):
- **Route is `/api/ocr/improve`**, not `/api/ocr/gemini` (§2): it fronts a provider chain.
- **`OCR_GEMINI_MODEL` is required and has no default**; unset means "not configured". `/api/ai/transcribe` still defaults to the 404 model (open item).
- **`lib/firebase/sharedCounter.ts` allow-list** gained `"ocrCallBudget"`, and `lib/ocr/budget.ts` joined the expected list in `retentionInterplay.test.ts`. Without the first, every production budget check would have failed closed.
- **Upload image is Phase 4's 1600 px JPEG preview**, read back with `fetch(blobUrl)`; no re-decode, no `source` kept alive.
- **`OCR_AI_NOTE` replaces `OCR_NOTE`** (never both) when signed in, enabled and available; `OCR_NOTE` and its test are untouched. One sentence added to `/privacy`.
- Additive edits only to `lib/ai/{enabled,types,registry}.ts`, `providers/gemini.ts`, `lib/privacy/disclosure.ts`; guard-test edits in `callSites.test.ts` (importer set, route-importer test, Guard B over `features/ocr`, `components/ocr`, `hooks/useOcrJob.ts`, all three required to exist).
- **`/ocr` CSP gained `blob:` in `connect-src`** (found in Task 9, below). Scoped to `/ocr` only; every other route keeps the strict policy.

**Bug found by the Task 9 browser test, fixed test-first:** under the `/ocr` CSP (`connect-src 'self' https://*.googleapis.com https://*.google.com`), `fetch(blobUrl)` is blocked in chromium, firefox **and** webkit (`'self'` does not cover `blob:`). `loadCrop` does exactly that, so every signed-in "Improve with AI" would have failed to read its crop. `tests/ocr.spec.ts` "the page's CSP lets it read a blob URL back" failed on all three, `csp.test.ts` now pins `blob:` in `/ocr`'s `connect-src` and its absence everywhere else, and `next.config.ts` adds it for `ocr: true` only. The unit tests could not catch this; only a real browser could.

Task 9, what was run:
- **Playwright, no key** (`tests/ocr.spec.ts`, passes on chromium, firefox, webkit against a production `next start`): anonymous sees the improve checkbox disabled with "Sign in to use this", sees `OCR_NOTE` and never `OCR_AI_NOTE`, makes **zero** requests to `/api/ocr/improve`, still completes a local read, and has no "Improve with AI" button or "by AI" marker. Plus the blob-URL test above.
- **Headers** (`curl -I`, production build): `/`, `/documents` and `/api/ocr/improve` carry the strict CSP; `/ocr` carries the relaxed one including `blob:` in `connect-src`. Anonymous `GET` and `POST /api/ocr/improve` both return 401.
- **Model choice, live, through the real `geminiOcrProvider`** (one 4-crop call per model, synthetic 1200×140 JPEGs of Bengali with Bengali digits, a case number with dates, and Latin text; 9.8–18.9 KB each): `gemini-3.5-flash-lite` **2.2 s**, all four lines exact; `gemini-3.5-flash` **52 s**, all four exact. 52 s is more than twice `providerTimeoutMs` (25 s), so it would time out every batch. **Chosen: `gemini-3.5-flash-lite`.** `providerTimeoutMs` (25 s) and the rate limit (24 per 10 min) stay: at ~2 s per call a 40-line pass is 10 calls. Both models are listed by `models.list` for the project key. Two calls total, no 404s.

**Not done — needs a person with a Firebase login and a Gemini key set in `.env.local`** (`OCR_GEMINI_ENABLED=true`, `OCR_GEMINI_MODEL=gemini-3.5-flash-lite`; `.env.local` has the key but both OCR vars are empty): the signed-in browser pass on the court PDF and the licence-photo PDF (badge, Show local/AI reading, Copy all/Download contain AI text, the note switching to `OCR_AI_NOTE` and back); the **1600 px vs 2000 px digit check** on real court-page digit lines (the synthetic digits above were read correctly from images far smaller than 1600 px, which says nothing about a photographed page); `GET available` true/false; the budget test with `OCR_GEMINI_DAILY_CALL_BUDGET=2` and the Firestore increment; cancel during `improving`, a second file mid-pass, token lapse mid-pass; the largest request body and preview blob seen in DevTools against `maxRequestBytes` (3.8 MB) / `maxImageBytes` (1.5 MB). Until the size check runs, we do not know whether a 1600 px q 0.85 preview of a dense photo exceeds 1.5 MB (it would be reported as "too large to send", never sent).

**Provider-terms finding** (Gemini API Additional Terms, <https://ai.google.dev/gemini-api/terms>, read 2026-10-10): on **Unpaid Services** (free tier), Google "uses the content you submit to the Services and any generated responses to provide, improve" its products, "human reviewers may read, annotate, and process your API input and output", and it warns "Do not submit sensitive, confidential, or personal information to the Unpaid Services"; no retention period is stated. On **Paid Services** Google says it does not use prompts or responses to improve its products, but logs them "for a limited period of time" (unspecified) for abuse detection and may store them in any country where it has facilities. The terms treat images like prompts. In the EEA, Switzerland and the UK the paid-service terms apply to every tier. Consequence: `OCR_AI_NOTE` says *we* do not store the crops and does not deny what Google keeps, which is accurate, but it does not tell the user that Google may keep or have people review them. **Use a paid-tier key before enabling `OCR_GEMINI_ENABLED` in production**, and consider adding "Google processes them under its own terms" to `OCR_AI_NOTE`, as `AI_TRANSCRIPTION_NOTE` does (a wording change to a user-facing privacy line, deliberately left for a decision).

**TTL policy step (console, not in the repo):** create a Firestore TTL policy on collection `ocrCallBudget`, field `expireAt`, as for the other budget collection in `docs/data-retention.md`. Until then those documents are kept (one per provider per day).

Open items: no second provider benchmarked (adding one is an adapter, a registry line and `SUPPORTED_PROVIDER_IDS`); `/api/ai/transcribe` still defaults to `gemini-2.5-flash`; Whole pages mode sends page-sized images, so its AI accuracy is unmeasured; the flash-lite conjunct slip from §11 did not show on the synthetic lines but real conjunct-heavy text is unchecked; `/ocr` is now the only page whose CSP lets script `fetch` a `blob:`.

**Stopped here, waiting for approval before Phase 6.** (Phase 6 done, §17.)

## 17. Phase 6 status (2026-10-10) — done, uncommitted

`/ocr` is now reachable and indexable. `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (144 files / 2457 tests, unchanged: header and footer have no tests) and `npm run build` are green; a production `next start` returns 200 for `/ocr`, the home page carries both new links and `/ocr` no longer emits a `robots` meta.

Edits (all of them): `components/layout/SiteHeader.tsx` (a `/ocr` link labelled **OCR**, between Documents and Compare, so Compare stays last and Phase 7's "Open in Compare" reads left to right), `components/layout/SiteFooter.tsx` (**Text from images**, the page's own title, since the footer has room), `app/ocr/page.tsx` (dropped `robots: { index: false }`, which Phase 4 added only "until Phase 6 links the page").

Deviations / decisions:
- **Header made responsive below `sm`.** The header already overflowed at 360 px (§15 open item); a fourth link added ~58 px more. Below `sm` the wordmark text is `sr-only` (the অ mark stays, the link keeps its accessible name), the nav links use `px-2` and the gaps tighten. At 360 px the page's horizontal overflow went from ~131 px (pre-link) to **41 px** (with the link); 390 px: 11 px; 320 px: 81 px; 640 px and up: none. Measured signed out, light and dark, on `/`, `/ocr`, `/documents`. **Not fully fixed**: that needs a mobile menu, and the signed-in state (email link up to 10 rem) overflows regardless. This changes the header on every route below 640 px; revert the three class edits if you'd rather keep the wordmark.
- **No home-page mention.** `CapabilityPlate` says "Six facts you can check against the running code" and "Files do get uploaded", both of which an OCR row would contradict or renumber, and the landing copy is governed by `PRODUCT.md`. Left for a copy decision; the nav and footer already surface the page.
- No sitemap or `robots.txt` exists in `app/`, so nothing else needed updating.


## 18. Phase 7 status (2026-10-10) — done, uncommitted

"Open in Compare" hands the OCR reading to `/compare`'s Source field. `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (145 files / 2474 tests) and `npm run build` are green. `tests/ocr.spec.ts` (now 5 cases) passes on chromium, firefox and webkit against a production `next start`.

Built: `features/comparison/prefill.ts` (`stashComparePrefill`, `takeComparePrefill`, `browserPrefillStorage`; 17 tests in `features/comparison/__tests__/prefill.test.ts`), `hooks/useComparePrefill.ts`. Edited: `components/ocr/OcrSummaryBar.tsx` (new micro button, between Download and the filled Copy all), `components/comparison/ComparisonWorkspace.tsx` (reads the prefill once on mount into Source, text mode). No other existing page behaviour changed.

Decisions / deviations:
- **Payload is `{v:1, text, at}` JSON under `c2u:compare-prefill`, not bare text.** A stash older than 2 minutes (or dated in the future) is dropped, so a navigation that never finished cannot surprise a later visit to Compare. Anything malformed is cleared and ignored. Text is kept byte-for-byte.
- **Uses the same text as Copy all / Download** (`combineText` with the AI overlay), so Compare sees what the user sees.
- **Failure is visible, not silent:** if sessionStorage refuses the write (quota on a very long reading, blocked storage) the page stays on `/ocr` and shows "Couldn't hand this to Compare… Copy it and paste it there." (pinned by an e2e that makes `setItem` throw).
- **Compare shows a one-line status** under the settings row: "Source holds your OCR reading. Add the reference text as Target to see where they differ." It uses the existing token-driven collapse and the reduced-motion branch. Not in the original plan; without it text appears in Source with no explanation.
- Checked at 360 px: Compare with a prefill has no horizontal overflow.
- The limit of the hand-off is sessionStorage (~5 MB of UTF-16 in most browsers); a larger reading hits the failure message above. The Compare tier limit (3 000 chars on *Easy*) still applies after the text arrives, so a long reading shows Compare's existing "over the character limit" message.

Not verified: a real touch device and a screen-reader pass of the new status line; a reading near the sessionStorage ceiling (the failure path was tested by forcing the throw).

**Stopped here, waiting for approval before Phase 8** (QA pass + docs).

## 19. Phase 8 status (2026-10-10) — QA pass done, docs written, uncommitted

`npx tsc --noEmit` (exit 0), `npm run lint` (exit 0), `npx vitest run` (145 files / **2474** tests) and `npm run build` (exit 0; `/ocr` static, `/api/ocr/improve` dynamic) are green, run fresh after the last product edit. `tests/ocr.spec.ts` passes **15/15** (5 cases × chromium, firefox, webkit) against a production `next start`, both before and after the two fixes below.

### What was checked, and what it showed
- **Headers / CSP** (`curl -I`, production): `/`, `/converter`, `/documents`, `/compare`, `/privacy`, `/ocrfoo` and `/api/ocr/improve` carry the strict policy; `/ocr`, `/ocr/worker.min.js` and `/ocr/lang/ben.traineddata.gz` carry the relaxed one (`'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `blob:` in `img-src` and `connect-src`), one CSP header each. Only the `/ocr/*` assets carry the 1-day + 7-day SWR `Cache-Control`. Anonymous `/api/ocr/improve` is 401.
- **Layout, empty and with a result on screen**, chromium, light and dark: nothing inside `<main>` is wider than the viewport at 360, 390 or 320 px. Page-level overflow is the known header one (§15/§17): 41 / 11 / 81 px, identical empty and with results. Not from `/ocr`.
- **Reduced motion** (emulated): 0 infinite animations while reading and 0 running animations once done; without the preference, 1 infinite animation (the reading wash) during the read. So the scan line / pulse really are gated, not just hidden.
- **Keyboard:** every stop has a visible ring (2 px outline, or the primary button's box-shadow). Order is skip link, wordmark, nav, sign in, mode group (one radio stop), file input, Read text, Start over, then the summary-bar actions. No focus trap.
- **axe-core** (wcag2a/2aa/21aa + best-practice), `/ocr` empty and with results: dark mode **0 violations**. Light mode **one**: `color-contrast` 4.49:1 (needs 4.5:1) for `#707072` on `#f4f4f5`, 12 px, on the `PrivacyNote` foot band. It is a shared token, not OCR code: `/documents` fails identically, and `/`, `/converter`, `/privacy` have their own, larger, pre-existing contrast misses. **Not changed** (shared styling is outside §4's list); recorded for a separate pass.
- **Real corpus, 360 px, Embedded images:** the three Civil Revision 465/2009 variants start reading and show "Reading line 36 of 211" with the page and its row boxes in the mini-map. Whole read-through timings are Phase 4's (§15); not re-measured.

### Two defects found, both fixed (edits to feature-owned files)
- **Mini-map distortion at 360 px.** `OcrScannerBed`'s `MiniMap` forced every page into a 54×72 portrait box with `object-fill`, so a landscape page was visibly stretched. The slot keeps its 54×72 footprint (no layout jump); the page inside it now takes its own aspect ratio, and the row boxes (percentages of the page) follow it. Measured: a 612×204 pt page renders at ratio 3.00 (was squashed to 0.75); the court PDF's portrait page still shows its row boxes.
- **Row label wrapped at 360 px.** In `OcrResultRow`, "PAGE 1" broke onto two lines when the right-hand meta string ("95% · BEN+ENG · TESSERACT · VERIFY NUMBERS") took the width. The label is now `shrink-0 whitespace-nowrap`; the meta wraps instead. Measured: label height 16 px against a 15.68 px line.
- Neither has a unit test: the repo has no DOM test setup (Phase 4 decision), so they are proved by the measurements above in a throw-away Playwright probe (deleted; not part of the suite).

### Docs
`CLAUDE.md` gained an "OCR page" section (generated runtime assets, `best_int`, the split CSP and the `blob:` finding, Guard B, `ben`-first rule, fail-closed AI chain and why there is no default model, `OCR_NOTE` vs `OCR_AI_NOTE`, row stitching, the pdf.js shared-proxy and tesseract.js `terminate()` traps, the Compare hand-off, how to run the e2e). `README.md` gained the `/ocr` feature, tech-stack rows, structure lines, the `OCR_GEMINI_*` variables, `ocr:sync`, and three Known limitations.

### Not verified (honest list)
- **Signed-in AI path, live.** Still owed exactly as listed in §16: needs a Firebase login and `OCR_GEMINI_ENABLED=true` + `OCR_GEMINI_MODEL=gemini-3.5-flash-lite` in `.env.local`. Until it runs, the unit/e2e coverage stands in for it, and the 1600 px vs 2000 px digit check, the budget/Firestore increment, token-lapse and request-size observations are all still open. **Phase 8's own gate (§10: "signed-in with Gemini fallback") therefore cannot be called met.**
- Bundle size: this build's route table has no First Load JS column (Turbopack), so the "other routes did not grow" check was not repeated; the only evidence is Phase 4's 143-723 B figure. Phase 5-7 edits to shared code were small (`CopyButton`/`Progress` props, `ComparisonWorkspace` prefill, header/footer links) but not measured.
- A DOCX run and the 15 MB-PDF memory / slow-network cases were not repeated this phase. No real touch device, no screen-reader pass (axe and the keyboard trace stand in, they do not replace one), no scroll-smoothness / blob-URL-leak check on the 211-row result, no timeout tuning on a slow phone (§14 still provisional).
- Firefox and WebKit were only exercised through the e2e file, not the layout/axe/reduced-motion probes (chromium only).

### Open items carried forward
Header overflow below ~640 px (needs a mobile menu) and the shared 4.49:1 contrast token; `/api/ai/transcribe` still defaults to the 404 model; no second AI provider benchmarked; the Firestore TTL policy on `ocrCallBudget` is still a console step; the `OCR_AI_NOTE` wording about Google's own retention is still a copy decision (§16); `ocr:sync` output is gitignored and rebuilt by `predev`/`prebuild` (say so if you would rather commit it).

**Stopped here.** Nothing is committed. The phase plan is otherwise complete; the remaining gate is the signed-in live pass above.
