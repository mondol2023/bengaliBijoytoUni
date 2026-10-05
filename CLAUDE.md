# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Convert2Uni — converts legacy Bengali font encodings (Bijoy, SutonnyMJ, alpha-ANSI) into
standards-compliant Unicode, for pasted text and for whole `.pdf`/`.docx`/`.doc`/`.txt`
documents. Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Firebase. The repo
root for all commands below is `convert2uni/` (there is also an unrelated empty
`package-lock.json` one level up — ignore it).

Full product/architecture detail lives in [`README.md`](README.md) — read it before making
non-trivial changes; this file only covers what the README doesn't and what a future session
needs to not re-litigate.

Three more local-only docs exist and are gitignored (planning artifacts, not shipped docs):
`PROGRESS.md` (phase-by-phase build log and the current standing agreement — read this first
if picking up mid-task), `PRODUCT.md` (positioning/brand constraints for anything
landing-page or marketing-copy related), `DESIGN.md` (visual design system, from the
`impeccable` skill). Keep them updated as you go; don't assume they're committed anywhere.

## Commands

```bash
npm run dev              # dev server (Turbopack)
npm run build             # production build
npm run start              # run a production build
npm run lint                 # ESLint (flat config, eslint-config-next)
npx tsc --noEmit               # typecheck
npm run test                    # vitest run — whole suite once
npm run test:watch               # vitest watch mode
npx vitest run path/to/file.test.ts          # a single test file
npx vitest run -t "test name substring"      # a single test by name
```

Every change is expected to pass `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, **and**
`npm run build` before being considered done — this is the project's own standing validation
bar (see `PROGRESS.md`). All four are green as of 2026-09-21.

Two notes on that, since earlier revisions of this file said otherwise:

- The old "Known build issue" (~89 `Can't resolve 'child_process'/'dns'/<grpc>` errors from a
  missing `serverExternalPackages: ["firebase-admin"]`) **does not reproduce**. Next 16.3.5
  compiles this app cleanly without that option; the only thing that had been failing
  `npm run build` was a single typecheck error in `features/converter/__tests__/conversion.test.ts`
  (reading `details.field` off an un-narrowed `AppError`), now fixed. Don't add
  `serverExternalPackages` for a problem that isn't there — if grpc resolution errors come
  back after a Next upgrade, that's the moment to reach for it.
- `next.config.ts` pins `turbopack.root` to this directory. The parent folder holds a stray
  empty `package-lock.json`, and without the pin Turbopack warns on every build that it is
  ignoring a lockfile outside the git repo.

## Architecture

### The conversion engine is pure, isomorphic TypeScript

`features/converter/engine/pipeline.ts` (`convertLegacyText`) is the single entry point,
called identically from the browser (`hooks/useConversion.ts`, live/debounced) and from the
server (`app/api/documents/extract/route.ts`, after file extraction) — one code path
regardless of input source. Pipeline: **tokenize → encoding-specific `postProcess` → generic
reorder pass → assemble → NFC normalize → validate**.

- **Tokenizer** (`tokenize.ts`): longest-match-first against the encoding's glyph table, so
  multi-byte legacy clusters aren't split incorrectly.
- **Reorder pass** (`reorder.ts`): legacy Bengali keyboards type *visual* order; this
  re-sequences reph, hasant/virama, pre-base vowel signs, and conjuncts into Unicode *logical*
  order. This is a separate, generic pass — not baked into the tokenizer or the per-encoding
  tables.
- **`postProcess`** (per-encoding hook on `EncodingDefinition`): for sequences no whole-cluster
  table lookup can express, e.g. a visible hasant split by an intervening pre-base vowel sign
  (`encodings/bijoy/rules.ts`). Reserved for exactly this class of problem — don't reach for it
  before a straight table entry.
- **`validate.ts`**: never throws away what it can't map. Unmapped sequences are collected with
  occurrence counts and up to three *converted-context* windows (offending bytes wrapped in
  ⟦⟧) so a human can tell what the missing rule should be — a bare byte list isn't actionable.
  Logged on the **success path too**, not just on hard failures, because "some Bengali came out
  but part of it was silent filler" is the actual dangerous failure mode here.
- Because this module runs in the browser, it (and anything it imports, like
  `engine/version.ts`) must stay dependency-free of Node core modules (`crypto`, etc.) — see
  the FNV-1a hash used instead of `node:crypto` in `version.ts`.

### Adding a legacy encoding

A new folder under `features/converter/encodings/<id>/` (`index.ts` + `map.ts` + `rules.ts`),
one `registerEncoding()` call in `encodings/registry.ts`, fixtures under
`features/converter/__tests__/`. The engine itself doesn't change — this is the intended
extension point. See `PROGRESS.md`'s "Open: more legacy fonts" section before adding one: several
candidate fonts (Boishakhi, BornoSoft/Falgun, Bangshi, SomewhereinBlog) were investigated and
deliberately blocked on insufficient/single-source data — check there before re-deriving a
table from scratch. New mapping-table entries require independent corroboration (two sources,
or one source verified by round-tripping a real document) — see `PROGRESS.md` Phase 9.6 for
the standard that was applied and why single-source entries were rejected even when plausible.

### Error model: `Result<T, AppError>`, never bare throws across a boundary

`lib/errors/types.ts` defines a discriminated `AppError` (one variant per `AppErrorCode`) and
an `ok`/`err` `Result` type. Every engine (conversion, comparison, documents, usage) and every
API route uses this instead of throwing/returning ad hoc shapes. `message` is always
user-safe; `debug` is server-only and stripped before a response ever serializes
(`lib/errors/handlers.ts` — every route funnels through this, so a raw stack trace can't leak
client-side by accident). When adding a new failure mode, prefer an existing `AppErrorCode`
over inventing a new one unless it needs its own HTTP status/shape.

Two rules that are load-bearing rather than stylistic:

- **An API route gets its error responder from `failResponder("api/its/path")`**, declared once
  at module scope, instead of hand-rolling a private `fail()`. Every route used to carry a
  byte-identical copy (21 of them), which gave the response contract 21 places to drift. The
  shared one is also where `Retry-After` gets set on a `RATE_LIMIT_ERROR`.
- **`toAppError` recognizes our errors by checking `code` against the real `AppErrorCode` set**,
  not by duck-typing `"code" in cause`. A `FirebaseError` is also `{ code, message }`, so the
  old shape check passed Firestore's own message through as if it were user-safe and left
  `statusForAppError` with no matching case — which returned `undefined`, and
  `Response.json(body, { status: undefined })` sends **200**. Anything unrecognized now becomes
  an `UNKNOWN_ERROR` carrying the caller's fallback message, with the original preserved in
  `debug`. `lib/errors/__tests__/handlers.test.ts` locks both halves down.

### Auth: bearer token everywhere, one narrow exception

Every API route authenticates via `requireServerUser`/`requireAdminUser`
(`lib/auth/session.ts`), which verifies a Firebase ID token sent as `Authorization: Bearer
<token>` — role/tier is read only from the verified token's custom claims or the caller's own
server-verified profile, never a client-supplied field. The **one** exception:
`app/admin/layout.tsx` (a server component, so it has no bearer token to read) gates on an
httpOnly session cookie via `getServerSessionUser()`, set/cleared only by
`POST/DELETE /api/auth/session`. This cookie is explicitly defense-in-depth for the initial
page gate only — every actual mutation still re-verifies through the bearer-token path. Don't
extend the cookie mechanism to cover new routes; add bearer-token checks instead.

### Firebase is lazy-loaded and env-gated, not a hard dependency

`isFirebaseConfigured` / `isFirebaseAdminConfigured` are synchronous env checks; the actual
SDK accessors (`lib/firebase/client.ts`, `admin.ts`) are dynamic/async so the app runs (with
sign-in/persistence disabled) with no Firebase project configured at all, and so the client
SDK doesn't get pulled into the bundle of public routes that never touch it (see README
"Problems we faced" for the bundle-size incident this fixed). Follow the same pattern for any
new Firebase-touching module: check the `isConfigured` flag, import the SDK on demand, degrade
rather than crash. Firestore timestamps are stored as ISO strings, not `Timestamp` objects —
match this on any new collection/schema (`lib/firebase/schemas.ts`, zod-validated at every
read/write boundary — this is the only validation layer for Firestore data).

### `assertServerOnly` — technical, not just documentary, boundary enforcement

`lib/ai/assertServerOnly.ts` throws if a module holding a provider API key is ever evaluated
where `window` is defined. It's a custom guard rather than the `server-only` package because
`server-only` only no-ops under Next's own webpack build (`"react-server"` condition) and
unconditionally throws under plain Node/Vitest, which would break unit tests that import a
provider module with a mocked `fetch`. Call it at module scope, right after imports, in any
new file that holds a secret and must never reach a browser bundle.

### Conversion-failure AI-resolution pipeline (partially built, admin-only)

`lib/ai/*` + Firestore collections `conversionFailures` / `failurePatterns` / `aiResolutions`
(full spec: `docs/conversion-failure-pipeline.md`). Turns a durable, deduplicated record of
every unmapped/failed conversion into an optional **candidate** fix from an external AI
provider (Gemini/OpenAI, via `lib/ai/registry.ts` — callers look up a provider by id there,
never import `providers/*.ts` directly) — never automatic, never authoritative; a human always
accepts/rejects before anything touches an actual `encodings/*/map.ts` table. Dedup/cost
control is a deterministic Firestore doc ID (`computeResolutionKey`, hashing
pattern+provider+model+promptVersion+engineVersion+rulesHash) claimed transactionally
(`claimResolutionSlot`) before any provider call, so concurrent requests for the same key get a
409 instead of triggering a second paid call. **This is fully built, admin UI included** —
`/admin/conversion-failures` (list) and `/admin/conversion-failures/[patternId]` (detail, with
working "Resolve with Gemini/OpenAI" and accept/reject controls via
`hooks/useConversionFailureDetail.ts`). Earlier revisions of this file and of
`docs/conversion-failure-pipeline.md` said the UI was unbuilt; that was stale. See
`docs/conversion-failure-pipeline.md` §7.3 for the one thing that genuinely isn't built.

### Compare page: English spellcheck

`features/comparison/spelling/` (pure TS, same rules as the conversion engine: no React, no Node
core modules) + `hooks/useSpellcheck.ts` + `components/comparison/SpellingSummary.tsx`. Full
design and the deliberate trade-offs: `docs/superpowers/specs/2026-10-05-compare-spellcheck-design.md`.
Things a future session would otherwise re-learn the hard way:

- **Compare input is full of references** — case numbers, bank bills, land records (`123/2020`,
  `Dag 45/B`, `A/C 0012-3456`, `Rs.5000/-`). `tokenize.ts` skips any whitespace chunk containing a
  digit or a code character, and only checks parts of 4+ letters in a letters-only `a/b` chunk.
  Don't "simplify" that into a plain word regex; `spelling.test.ts` has the cases.
- **Legacy Bijoy text is Latin-looking gibberish**, so `legacyGate.ts` skips such a side. Don't
  swap in `detectEncoding` for this: it reports legacy-range coverage 1 on text with no high
  characters, so ordinary English scores as a confident Bijoy match.
- **Dictionaries are static files**, not imports: `dictionary-en`/`dictionary-en-gb` read their
  data with `node:fs` and cannot be bundled for the browser. `npm run dict:sync` copies them to
  `public/dictionaries/`; the app fetches them lazily (dynamic `import()` of `loadChecker.ts`, so
  `nspell` stays out of the initial bundle). British **and** US spellings are both accepted.
- The checker is injected (`SpellChecker`), so engine tests use a fake dictionary; only
  `spellingDictionary.test.ts` loads the real files.
- Diff marks: word mode maps whole-text findings onto segments by offset (so a reference split
  across a diff boundary keeps its context); paragraph mode checks each segment on its own.
  `useComparison` exposes `comparedTexts` so offsets always match the diff's inputs.

### Route/feature layout

`app/` is routes + API handlers only; real logic lives in `features/<domain>/` (paired with
its own `__tests__/`) and `lib/<concern>/`, with `hooks/` as thin React wrappers over them.
`components/` is presentational, grouped by feature. When changing behavior, look for it in
`features/`/`lib/` first — `app/` files are usually just wiring.

### Rendering Bengali vs. legacy bytes

The two are never interchangeable on screen, and the distinction is functional, not cosmetic:

- **Converted Unicode Bengali** → `font-bengali` **and** `lang="bn"`, so a screen reader
  switches to a Bengali voice. Put `lang` on the Bengali itself, not on a panel that also
  holds English placeholder or error copy.
- **Legacy source bytes** (`failedSequence`, a `fullText` capture, context windows, the ghost
  behind the giant specimen) → `font-mono`. Noto Sans Bengali has no glyphs for the Latin-1
  code points a legacy sequence is made of, so setting bytes in it produces an unpredictable
  system fallback — in exactly the panels whose job is making those bytes legible.
- Read-only converted output is a `role="region"` with `aria-live="polite"`, not a
  `role="textbox"`. A textbox role promises an editable, focusable field; these are neither.

## Standing process note

Per `PROGRESS.md`: prior work on this codebase followed "one phase at a time — implement,
validate (typecheck/lint/test/build), report, then pause for explicit go-ahead before the
next phase." If `PROGRESS.md` shows an unstarted phase, don't start it without being asked.
As of 2026-10-04 every `PROGRESS.md` phase is done (Phase 10's four checks pass); the
conversion-failure hardening is tracked phase by phase in `legacy2uni.md` (Phase 7,
verification, in progress).
