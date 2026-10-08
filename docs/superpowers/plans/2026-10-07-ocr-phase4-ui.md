# OCR Phase 4 (UI): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/ocr` page. It is not linked from the nav yet. A user drops a PDF or DOCX, picks *Embedded images* or *Whole pages*, and watches a live **scanner bed** read the file in the browser. Text arrives line by line beside the image it came from, with copy-all and download.

**Architecture:** All decisions live in pure, node-testable modules under a new `features/ocr/job/`. `prepareOcrSource` turns a file into ordered work items. `ocrJobReducer` holds the job state and doubles as the stale-result guard. `view.ts` formats labels, markers and combined text. One browser-only module (`browserRuntime.ts`) wires the real Tesseract engine, the canvas and pdf.js. The hook loads it with `import()`. `hooks/useOcrJob.ts` is a thin driver around `runOcrJob` (Phase 3). `components/ocr/*` are presentational.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, `motion/react`, Radix Progress, pdfjs-dist 6.4.299, tesseract.js 7.0.0, vitest (node env, no DOM testing library), Playwright for one browser smoke test.

**Spec:** [`docs/ocr-extraction-plan.md`](../../ocr-extraction-plan.md) §2, §6, §11 to §14. Visual reference: the "OCR Scanner Bed" design canvas (https://claude.ai/artifact/Xgcj4QAzL5XiQUGWhKKdDA), with the live desktop page, the phone view and the edge states.

## Global Constraints

- Read `CLAUDE.md`, `DESIGN.md` and the spec before starting.
- New files only, except: `scripts/ocr-sync.mjs` and `features/ocr/config.ts` (both OCR-owned, from Phase 3), plus **one additive export in `lib/privacy/disclosure.ts`** (deviation from spec §4, see Task 5).
- Do not touch the header or footer (Phase 6), Compare (Phase 7) or anything Gemini (Phase 5). No Gemini control appears in Phase 4.
- `features/**` never imports `lib/ai`. Errors are `Result<T, AppError>`, and user-facing copy comes only from `error.message`.
- pdf.js, JSZip and tesseract.js load only through `import()` started by a user action. No other route's First Load JS may change.
- Bengali output: `font-bengali` + `lang="bn"` on the text element itself. Image strips are `aria-hidden`.
- Motion: every value comes from `lib/motion/tokens.ts`. Every animated component branches on `usePrefersReducedMotion` and shows the *finished* state. No literal durations or easings at call sites.
- DESIGN.md: no cards, no shadows on in-page surfaces, square content surfaces, terracotta only for live or actionable things, ochre only for "check this" disclosures, and mono only for computed figures.
- Validation bar: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`. **Do not commit** (project rule: stop and report after the phase).

## Review Focus

1. **Running "Read whole pages" after an embedded run.** `openPdf` detaches the buffer it is given. The expected behaviour is that the re-run works. The hook must read `file.arrayBuffer()` fresh on every `start()`. Pinned by the Task 6 browser step "Nothing found → Read whole pages".
2. **A new file or Start during a running job.** Old outcomes must never show up against the new job. Pinned by the reducer's stale-`jobId` tests (Task 3).
3. **A renamed or wrong file** (`.doc` renamed to `.docx`, a PNG named `.pdf`). Expected: a clear "not a PDF or Word file" error, not a pdf.js crash. Pinned by magic-byte tests (Task 2).
4. **JPEG and JBIG2/JPX scans in a real browser** (the `ImageBitmap` and wasm decoder paths are untested in Node). Expected: they read, and are not counted as unreadable. Pinned by Task 1 (decoders hosted) and the Task 6 corpus check.
5. **Large jobs** (the court PDF has 211 rows). Expected: the page stays scrollable at 60 fps, with no announcement storm and no blob-URL leak across repeated runs. Pinned by Task 5 (`content-visibility`, a single live region) and the Task 6 checks.

---

### Task 1: Host the pdf.js decoders and fonts, and add the preview constants

pdf.js 6 decodes JBIG2 and JPEG 2000 (the usual scanned-PDF codecs) with `wasm/` files, and draws non-embedded fonts from `standard_fonts/` + `cmaps/`. `ocr:sync` copies none of them, so in the browser those scans would come back "unreadable" and whole-page renders could drop text.

**Files:**
- Modify: `scripts/ocr-sync.mjs` (add directory copies)
- Modify: `features/ocr/config.ts`
- Test: `features/ocr/__tests__/config.test.ts`

**Interfaces:**
- Produces: `OCR_PDF_WORKER_SRC = "/ocr/pdf.worker.min.mjs"`; `OCR_PDF_DOCUMENT_OPTIONS: Readonly<Record<string, unknown>>` = `{ wasmUrl: "/ocr/pdfjs/wasm/", cMapUrl: "/ocr/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/ocr/pdfjs/standard_fonts/", iccUrl: "/ocr/pdfjs/iccs/" }`; `OCR_PREVIEW_MAX_EDGE_PX = 1600` (row/page previews, readable when enlarged); `OCR_BED_PAGE_MAX_EDGE_PX = 900` (scanner-bed page render).

- [ ] **Step 1:** Check the option names against `node_modules/pdfjs-dist/build/pdf.mjs` (`wasmUrl`, `cMapUrl`, `standardFontDataUrl`, `iccUrl`). Drop any that pdf.js 6.4.299 does not read, and record the result in the Task 6 report.
- [ ] **Step 2: Failing test.** In `config.test.ts`, `it("points pdf.js at the self-hosted decoder dirs")`: every URL value in `OCR_PDF_DOCUMENT_OPTIONS` starts with `/ocr/pdfjs/` and ends with `/`. `it("keeps previews within the page pixel cap")`: `OCR_PREVIEW_MAX_EDGE_PX ** 2 <= OCR_MAX_PAGE_PIXELS`.
- [ ] **Step 3:** Run `npx vitest run features/ocr/__tests__/config.test.ts`. Expected: FAIL (exports missing).
- [ ] **Step 4:** Add the constants. In `ocr-sync.mjs`, copy `pdfjs-dist/{wasm,cmaps,standard_fonts,iccs}/` recursively to `public/ocr/pdfjs/<dir>/`, keeping the size-equality skip. Update the header comment's size estimate.
- [ ] **Step 5:** Run the test (PASS), then `npm run ocr:sync` twice. Expected: the first run copies, the second prints "already up to date". `ls public/ocr/pdfjs` shows the four dirs. The CSP is unchanged: `/ocr/:path+` already covers them.

### Task 2: File detection and `prepareOcrSource`

**Files:**
- Create: `features/ocr/job/fileKind.ts`, `features/ocr/job/source.ts`
- Test: `features/ocr/__tests__/source.test.ts` (fixtures: `helpers/pdfFixture.ts` `buildPdf`/`patternRgb`, `helpers/nodeCanvas.ts` `nodeCanvasEnv`/`solidPng`, JSZip-built DOCX as in `docxImages.test.ts`, the pdf.js legacy-build loader those tests use)

**Interfaces:**
- Consumes: `openPdf`, `scanPdfImages`, `createRowRenderer`, `renderPdfPage`, `listDocxImages`, `decodeDocxImage`, `planEmbeddedRows`, `planUnplacedImages`, `checkPageCap`, `checkItemCap` (Phases 1–3).
- Produces:
```ts
export type OcrFileKind = "pdf" | "docx";
export function detectOcrFileKind(name: string, head: Uint8Array): Result<OcrFileKind>;

export interface OcrItemMeta {
  id: string;            // "p3-r4" | "page-3" | "img-5"
  label: string;         // "Page 3 · line 4" | "Page 3" | "Image 5"
  page: number | null;   // null for DOCX
  box: Box | null;       // top-left-origin pt on its page (embedded PDF rows only), for the bed overlay
}
export interface OcrSourceItem extends OcrItemMeta { load(): Promise<RawImage | null> }
export interface OcrSourcePage { page: number; widthPt: number; heightPt: number }
export interface OcrSource {
  kind: OcrFileKind;
  mode: OcrMode;
  items: OcrSourceItem[];
  pages: OcrSourcePage[];        // [] for DOCX
  skipped: { decorative: number; duplicate: number; tinyRow: number };
  unreadable: number;
  /** PDF only: a low-res render of one page for the scanner bed. */
  renderPagePreview: ((page: number) => Promise<Result<RawImage>>) | null;
  dispose(): Promise<void>;
}
export interface SourceDeps { canvas: CanvasEnv; pdf?: OpenPdfOptions; signal?: AbortSignal }
export function prepareOcrSource(bytes: Uint8Array, kind: OcrFileKind, mode: OcrMode, deps: SourceDeps): Promise<Result<OcrSource>>;
export function isModeAvailable(kind: OcrFileKind, mode: OcrMode): boolean; // docx + pages → false
```
Rules: kind comes from the **magic bytes** (`%PDF-` → pdf; `PK\x03\x04` → docx, confirmed later when `word/document.xml` is found). The extension only picks the error wording. A row renderer or decoder `err` maps to `load()` → `null` (counted unreadable, not failed). Page sizes come from `getViewport({ scale: 1 })`. The bed preview renders at `min(OCR_BED_PAGE_MAX_EDGE_PX / longEdgePt, pageRenderScale(...))`.

- [ ] **Step 1: Failing tests.**
  - `detectOcrFileKind`: `%PDF-1.7` head → `pdf`; `PK\x03\x04` → `docx`; a PNG signature named `scan.pdf` → `err` with `details.reason === "unsupported_format"` and a message containing "PDF or Word"; an empty head → `err`.
  - PDF embedded: a 2-page fixture, with page 1 holding two rows of 3 fragments each and page 2 holding one row, plus a repeated logo. Expect `items.map(i => i.label)` to equal `["Page 1 · line 1", "Page 1 · line 2", "Page 2 · line 1"]`, every `box` non-null, `skipped.duplicate >= 1`, `pages.length === 2` with positive sizes, and `await items[0].load()` to be an RGBA image whose width is the stitched width.
  - PDF pages mode: `items.length === pageCount`, labels `"Page N"`, `box === null`.
  - DOCX: 3 images, one tiny (decorative). Labels `["Image 1", "Image 2"]`, `page === null`, `pages` `[]`, `renderPagePreview === null`.
  - Nothing found: a text-only PDF → `ok` with `items` `[]` (not an error).
  - `isModeAvailable("docx", "pages") === false`, and `prepareOcrSource(docx, "docx", "pages")` → `err`.
  - `dispose()` twice does not throw.
- [ ] **Step 2:** Run `npx vitest run features/ocr/__tests__/source.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement both files. `prepareOcrSource` owns opening, scanning, planning, the cap checks, and a single `RowRenderer`. Items stay in page order (the renderer requirement in §13).
- [ ] **Step 4:** Run the test. Expected: PASS. Run the whole `features/ocr` folder. Expected: PASS.

### Task 3: Job reducer and view helpers

**Files:**
- Create: `features/ocr/job/jobState.ts`, `features/ocr/job/view.ts`
- Test: `features/ocr/__tests__/jobState.test.ts`, `features/ocr/__tests__/view.test.ts`

**Interfaces:**
- Consumes: `ItemOutcome`, `DoneOutcome` (orchestrator), `OcrItemMeta`, `OcrSourcePage` (Task 2), `isMostlyBengali` (postprocess), `SafeErrorResponse`.
- Produces:
```ts
export type OcrPhase = "idle" | "opening" | "preparing" | "reading" | "done" | "cancelled" | "error";
export interface OcrJobState {
  phase: OcrPhase; jobId: number;
  items: OcrItemMeta[]; pages: OcrSourcePage[];
  outcomes: Record<string, ItemOutcome>;
  reading: string[];                         // ids loaded but not finished, in start order
  previews: Record<string, string>;          // item id → blob URL
  pagePreviews: Record<number, string>;      // page → blob URL
  skipped: OcrSource["skipped"]; unreadable: number;
  error: SafeErrorResponse | null;
}
export type OcrJobAction =
  | { type: "start"; jobId: number }
  | { type: "sourceReady"; jobId: number; items: OcrItemMeta[]; pages: OcrSourcePage[]; skipped: OcrSource["skipped"]; unreadable: number }
  | { type: "warmed"; jobId: number }
  | { type: "itemStarted"; jobId: number; id: string }
  | { type: "preview"; jobId: number; id: string; url: string }
  | { type: "pagePreview"; jobId: number; page: number; url: string }
  | { type: "itemDone"; jobId: number; outcome: ItemOutcome }
  | { type: "finished"; jobId: number; cancelled: boolean }
  | { type: "failed"; jobId: number; error: SafeErrorResponse }
  | { type: "reset" };
export const initialOcrJobState: OcrJobState;
export function ocrJobReducer(state: OcrJobState, action: OcrJobAction): OcrJobState;
export function blobUrlsOf(state: OcrJobState): string[];   // the hook revokes these

// view.ts
export interface ItemView { tone: "ok" | "check" | "failed" | "unreadable"; confidenceText: string | null; needsCheck: boolean; hasDigits: boolean; lang: "bn" | "en" }
export function describeItem(outcome: ItemOutcome): ItemView;
export function combineText(items: readonly OcrItemMeta[], outcomes: Record<string, ItemOutcome>): string;
export function jobMarker(state: OcrJobState): string;
export function stageLine(state: OcrJobState): string;
export function previewSize(width: number, height: number, maxEdge: number): { width: number; height: number };
export function ocrDownloadName(fileName: string): string;
```
Copy (exact, from the design canvas): marker `idle` → `"pdf · docx · 15 MB"` (computed from `OCR_MAX_FILE_BYTES`); `preparing` → `"Preparing"`; `reading` → `"Reading · {total} lines"` (or `pages`/`images`), fixed for the whole run, because `ToolHead`'s marker is `aria-live="polite"` and must not change per item (the live count lives in `stageLine` and the readouts); `done` → `"{read} read · {check} to check"`; `cancelled` → `"Stopped · {read} read"`. Stage line: `opening` → `"Opening the file…"`, `preparing` → `"Preparing the reader…"`, `reading` → `"Reading line {n} of {total}"`, or `"Reading page {n} of {total}"` in pages mode and `"Reading image {n} of {total}"` for DOCX. Here n = completed + 1, capped at total.

- [ ] **Step 1: Failing reducer tests.**
  - Any action whose `jobId !== state.jobId` returns the **same object** (the stale guard).
  - `start` clears outcomes, previews and error, sets `phase: "opening"` and the new `jobId`.
  - `itemStarted` appends to `reading`. `itemDone` removes it from `reading` and stores the outcome.
  - `finished { cancelled: true }` → `"cancelled"`; `{ cancelled: false }` → `"done"`.
  - `failed` → `"error"`, outcomes kept (partial results survive).
  - `reset` → `initialOcrJobState`, keeping `jobId` (so late actions stay stale).
  - `blobUrlsOf` returns every item and page preview URL.
- [ ] **Step 2: Failing view tests.**
  - `describeItem` for done outcomes: `fallback.needed` → `tone: "check"`; confidence 93.6 → `"94%"`; Bengali text → `lang: "bn"`; `"নং ৪৫/২০২৫"` and `"No. 45"` → `hasDigits: true`. Unreadable and failed map to their tones with `confidenceText: null`.
  - `combineText` keeps input order, skips empty, unreadable and failed items, and joins with `"\n\n"`. It returns `""` when nothing is read.
  - `jobMarker` and `stageLine` produce the exact strings above for each phase and mode.
  - `previewSize(3500, 138, 1600)` → `{ width: 1600, height: 63 }`; a small image is unchanged; dimensions are never 0.
  - `ocrDownloadName("scan.final.pdf")` → `"scan.final.ocr.txt"`.
- [ ] **Step 3:** Run both test files. Expected: FAIL.
- [ ] **Step 4:** Implement. Pure functions only, with no React and no DOM.
- [ ] **Step 5:** Run both test files. Expected: PASS.

### Task 4: Browser runtime and `useOcrJob`

**Files:**
- Create: `features/ocr/job/browserRuntime.ts`, `hooks/useOcrJob.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `createOcrEngine`, `createTesseractWorkerFactory(BROWSER_TESSERACT_LOCATION)`, `browserCanvasEnv`, `runOcrJob`.
- Produces:
```ts
// browserRuntime.ts. Browser-only, reached only via import() from the hook.
export interface BrowserOcrRuntime {
  createEngine(): OcrEngine;
  canvas: CanvasEnv;
  pdf: OpenPdfOptions;                       // { workerSrc: OCR_PDF_WORKER_SRC, documentOptions: OCR_PDF_DOCUMENT_OPTIONS }
  toPreviewUrl(image: RawImage, maxEdge: number): Promise<string>; // canvas → JPEG blob (q 0.85) → object URL
  prepare: typeof prepareOcrSource;          // re-exported so pdf.js/JSZip stay in this lazy chunk
}

// useOcrJob.ts
export function useOcrJob(): {
  state: OcrJobState;
  file: File | null; setFile(file: File | null): void;
  mode: OcrMode; setMode(mode: OcrMode): void;
  fileKind: OcrFileKind | null;              // from the first bytes, for disabling Whole pages on DOCX
  start(): void; cancel(): void; reset(): void;
};
```
Decisions the implementer must keep:
- `start()` increments `jobId`, aborts any running job, revokes the old `blobUrlsOf`, then reads **fresh bytes from `file`** every time.
- One engine per hook instance, created lazily and reused across jobs (workers stay warm). If a job fails at warm-up, dispose the engine and create a new one next time, because the start circuit breaker lasts for the engine's lifetime. Dispose on unmount.
- Each `OcrSourceItem.load` is wrapped: dispatch `itemStarted`, await the image, make its preview (`OCR_PREVIEW_MAX_EDGE_PX`), dispatch `preview`, then return the image. On the first item of a new PDF page, fire `renderPagePreview` → `pagePreview` without awaiting it. In pages mode the item preview doubles as the page preview.
- `cancel()` aborts. The orchestrator finishes in-flight items and returns `cancelled: true` → `finished`.
- `source.dispose()` in `finally`. Revoke all blob URLs on reset and unmount.
- Errors go to `failed` through `toSafeError` (same shape `useDocumentConversion` stores).

- [ ] **Step 1:** Implement `browserRuntime.ts` and the hook. There are no unit tests here, because the repo has no DOM test setup and adding RTL/jsdom isn't justified for one hook. All branching logic sits in the reducer (Task 3). Proof comes in Task 6.
- [ ] **Step 2:** Run `npx tsc --noEmit` and `npm run lint`. Expected: clean.

### Task 5: Page, components, motion

**Files:**
- Create: `app/ocr/page.tsx`, and in `components/ocr/`: `OcrWorkspace.tsx`, `OcrDropzone.tsx`, `OcrModeToggle.tsx`, `OcrScannerBed.tsx`, `OcrProgress.tsx`, `OcrResultRow.tsx`, `OcrSummaryBar.tsx`, `OcrEmptyState.tsx`
- Modify: `lib/privacy/disclosure.ts` (add `OCR_NOTE: Bilingual`)
- Test: `lib/privacy/__tests__/disclosure.test.ts` (the existing completeness test must cover the new block; extend it if it lists blocks by hand)

Deviations from spec §2 and §6, made on purpose:
- `OcrItemCard` → **`OcrResultRow`**. DESIGN.md has no cards; results are a ruled row list.
- The results region is **not** `aria-live`. With 300 rows that would mean 300 announcements. Phase changes and the final summary are announced by `ToolHead`'s existing live marker, which `jobMarker` changes only per phase. `ToolHead` itself is not edited.
- `OCR_NOTE` lives in `disclosure.ts`, because that file's own rule is that every disclosure string lives there. English: "Read in your browser. The file is not uploaded. The first time, your browser downloads the reading engine once and keeps it." Bengali draft: "লেখা আপনার ব্রাউজারেই পড়া হয় — ফাইল আপলোড হয় না। প্রথমবার আপনার ব্রাউজার পড়ার ইঞ্জিনটি একবার ডাউনলোড করে রেখে দেয়।" Flag it for native review, as the file's header requires.

Layout (the design canvas is the reference):
- `page.tsx`: metadata title `"Text from images — Convert2Uni"`, plus `robots: { index: false }` until Phase 6 links the page. It renders `<OcrWorkspace/>`.
- `OcrWorkspace`: a `tool-plate` → `ToolHead` (title "Text from images", marker = `jobMarker`) → a ruled settings row (`OcrModeToggle` left, file name + size right) → `OcrDropzone` + a **Read text** primary button (the only filled button until results exist) → a 12-col grid at `lg`: `OcrScannerBed` spans 5, the results sheet spans 7. Below `lg` it stacks, and the bed becomes `compact` and `sticky top-0` (the phone artboard) → `PrivacyNote note={OCR_NOTE}` on the foot band.
- `OcrModeToggle`: encoding-chip styling over visually hidden radios. *Whole pages* is disabled for DOCX, with the hint "Whole pages works on PDFs".
- `OcrScannerBed`: a sheet with the band "Scanner bed" / "Page n of N".
  - **Embedded PDF**: the `pagePreview` image on a galley-grey bed, with an absolutely placed box per row of that page. Each box is `box` scaled from pt to the rendered width. Boxes are keyline when read, terracotta plus a pulsing wash while in `reading`, and none while pending. A 2px terracotta **scan line** rides the foot of the newest `reading` box. Below sits a filmstrip of page thumbnails, with the current page bordered in terracotta.
  - **Pages mode**: the current page preview with a scan line sweeping top to bottom while it reads.
  - **DOCX**: a contact sheet of item previews, using the same box states.
  - The foot marker shows the skipped and unreadable counts.
  - `compact` = the 54×72 mini-map plus stage line, Cancel and bar.
- `OcrProgress`: stage line, Cancel micro-control, and a 2px `Progress` bar (indeterminate slide while `preparing`).
- `OcrResultRow`: marker row (`label` left; `"94% · ben · Tesseract"` right, ochre when `needsCheck`). Then the preview `<img>` (`aria-hidden`, `alt=""`): full width for strips with aspect > 4, otherwise a 10rem column beside the text. Clicking it opens `Dialog` at full preview size. Then the text `<p lang={view.lang}>`, in `font-bengali` when `bn`. When `needsCheck`, add an ochre `sheet-note`: "Low confidence. Check this line against the image, especially the numbers." If `hasDigits` and not `needsCheck`: the marker suffix `"· verify numbers"`. Unreadable and failed rows show their message in place of text. Each row gets `style={{ contentVisibility: "auto", containIntrinsicSize: "auto 160px" }}`.
- `OcrSummaryBar` (sheet band once `done`/`cancelled` with ≥1 read): Read again (micro), Download .txt (micro, `downloadTextFile(ocrDownloadName(...), combineText(...))`), **Copy all** (`CopyButton variant="primary"`). There is no "Open in Compare" (Phase 7) and no "Retry with Gemini" (Phase 5).
- `ReadoutStrip` across the foot: Lines `{read}/{total}`, To check (ochre when > 0), Engine `Local`, Unreadable.
- `OcrEmptyState`: covers nothing found ("No pictures of text in this file." + **Read whole pages** for PDFs + a link to `/documents`), the error (`role="alert"` danger note, with partial rows kept below it) and cancelled. Copy is exactly as on the States artboard.

Motion spec (all token-driven, with the reduced-motion branch in brackets):

| Moment | Values | Reduced motion |
|---|---|---|
| Page entry | the existing `containerVariants`/`itemVariants` stagger from `DocumentUploadWorkspace` | static |
| Scan line travel | `top` animated, `duration.slow`, `easing.standard`; trail wash = `accent` at low alpha | hidden; boxes still show state |
| Reading box wash | opacity pulse, `duration.deliberate`, `repeat: Infinity`, `repeatType: "mirror"` | solid terracotta border, no pulse |
| Row arrival | `x: -distance.md → 0`, `opacity 0 → 1`, `springs.gentle`, on mount only | static |
| Text resolve (signature) | `filter: blur(blur.md) → 0`, `y: distance.sm → 0`, `duration.slow`, `easing.expoOut`, delay = `staggerTight` × 3 | static text |
| Errors and notes | height auto collapse, `duration.fast`, `easing.standard` (as on `/documents`) | instant |
| Pages-mode sweep | `top 0 → 100%`, `duration.deliberate`, linear repeat while reading | hidden |

If a needed value (e.g. a pulse alpha) is missing from `tokens.ts`, adding it there is allowed; it is the one place values belong. Do not animate `layout` on the row list (cost on 300 rows).

- [ ] **Step 1:** Add `OCR_NOTE` and run `npx vitest run lib/privacy`. Expected: PASS, with the new block covered by the completeness test (extend the test if it enumerates blocks by hand).
- [ ] **Step 2:** Build the components in this order: Dropzone, ModeToggle, Progress, ResultRow, ScannerBed, SummaryBar, EmptyState, Workspace, page.
- [ ] **Step 3:** Run the validation bar. Expected: all four green. In the `npm run build` route table, `/ocr` is present and every other route's First Load JS is byte-identical to before (diff against a pre-change build output saved in Step 0 of Task 6).

### Task 6: Browser proof, then report

Phase 3 left these unproven in a real browser: the tesseract.js worker through Turbopack, the JPEG `ImageBitmap` path, and the IndexedDB data cache. This task closes them.

**Files:**
- Create: `tests/ocr.spec.ts`
- Modify: `docs/ocr-extraction-plan.md` (add §15 Phase 4 status)

- [ ] **Step 0** (do it before Task 5 Step 3): save the `npm run build` route table from the untouched tree, for the bundle diff.
- [ ] **Step 1: Playwright smoke test.** In `beforeAll`, build an English-text PDF in node. Render "HELLO OCR 2025" with `@napi-rs/canvas` into the RGB fixture shape and feed it to `buildPdf`. Then `goto(${process.env.OCR_E2E_BASE_URL ?? "http://localhost:3000"}/ocr)`, set the file input, choose *Whole pages*, click **Read text**, and expect a row containing `HELLO` within 120 s. Also check: Copy all is enabled; Download triggers a `.ocr.txt` download; there are 0 console errors and 0 CSP violations. Run it against `npm run dev` with `npx playwright test tests/ocr.spec.ts --project=chromium` (`npx playwright install chromium` if needed).
- [ ] **Step 2: Corpus checks** with `npm run build && npm run start`, recording results in §15:
  - The court PDF (row-fragment variant): about 211 rows, Bengali correct and set in Bengali, scroll smooth.
  - A CamScanner JPEG PDF: reads, not unreadable.
  - A DOCX with images.
  - Nothing found → **Read whole pages** re-run (Review Focus 1).
  - Cancel mid-run.
  - Start a second file mid-run (Review Focus 2).
  - A second visit: no re-download of `ben.traineddata` (DevTools network shows the IndexedDB cache).
  - Block `/ocr/lang/*` in DevTools: the error state appears within the start timeout, without hanging.
- [ ] **Step 3: Manual UI checks.** At 360 px: the sticky mini-bed works and there is no horizontal scroll. Keyboard-only: dropzone → mode → Read → Cancel → Copy all. Screen reader: one announcement per phase, and rows read in Bengali. Reduced motion (OS setting): finished states, no scan line. Dark mode: tokens follow.
- [ ] **Step 4:** Check that `curl -I` headers on `/`, `/documents` and `/ocr` match the Phase 3 record.
- [ ] **Step 5:** Write §15 in the spec doc: what was built, the deviations (OcrResultRow, the live-region change, `OCR_NOTE` placement, the decoder hosting, the pdf.js option names confirmed in Task 1), the measured timings and the open items. Then **stop and wait for approval** before Phase 5.

---

## Execution prompt (paste to start Phase 4)

> You are a senior Next.js/React engineer working in `convert2uni/` (Next.js 16, React 19, TS, Tailwind 4, motion/react). Read `CLAUDE.md`, `DESIGN.md`, `docs/ocr-extraction-plan.md` and this plan `docs/superpowers/plans/2026-10-07-ocr-phase4-ui.md` first, then open the design canvas https://claude.ai/artifact/Xgcj4QAzL5XiQUGWhKKdDA for layout and copy. Implement **only Phase 4**, task by task in order, test-first wherever the plan gives tests. Keep to the plan's Global Constraints, and stop and ask instead of inventing an interface the plan does not define. Match the surrounding code's style and comment density. After each task run its verification. At the end run `npx tsc --noEmit`, `npm run lint`, `npx vitest run` and `npm run build`, then report results, deviations and the Task 6 findings. Do not commit; wait for approval.
