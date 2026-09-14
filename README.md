# Convert2Uni

**Convert legacy Bengali font encodings (Bijoy, SutonnyMJ) into standards-compliant Unicode — for whole documents, not just pasted text.**

Anyone holding Bengali text that renders as gibberish in modern software — publishers and newsrooms migrating Bijoy/SutonnyMJ archives, government/legal/academic/NGO offices with legacy `.doc`/`.pdf` records, or an individual with one broken manuscript — arrives with a file that already looks wrong and needs it correct, usually without knowing the words "encoding" or "Unicode." Convert2Uni takes real `.pdf` / `.docx` / `.doc` / `.txt` files through the full pipeline, not a paste box, and it **reports what it could not map instead of silently mangling it.**

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, and Firebase.

---

## Table of contents

- [What it does](#what-it-does)
- [How the conversion works](#how-the-conversion-works)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Testing](#testing)
- [Security](#security)
- [Problems we faced (and how we handled them)](#problems-we-faced-and-how-we-handled-them)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)

---

## What it does

1. **Paste text or upload a file** (`.pdf`, `.docx`, `.doc`, `.txt`) written in a legacy Bengali keyboard encoding.
2. The app **auto-detects** whether it's Bijoy or SutonnyMJ (with manual override), runs it through the conversion engine, and returns correct Unicode Bengali — instantly, in the browser, with no server round-trip for the text-conversion step itself.
3. Anything the engine **couldn't confidently map** is surfaced, not hidden — as inline warnings and in a persistent failure log.
4. Two versions of a document (e.g. before/after conversion, or two conversion attempts) can be **compared side by side** with a word/paragraph diff and a similarity score.
5. Signed-in users get **saved history**; conversion itself never requires an account.

The live conversion demo on the landing page is the product's whole pitch: type a fragment, watch it convert in real time, judge the result yourself.

## How the conversion works

The engine (`features/converter/engine`) is a pure TypeScript pipeline with no server dependency, so it can run identically in the browser and on the server:

1. **Longest-match tokenizer** — walks the legacy-encoded string matching the longest known glyph sequence first, so multi-byte legacy clusters aren't split incorrectly.
2. **Reorder pass** — legacy Bengali keyboards type visual order, not logical order. The engine re-sequences reph, hasant/virama, pre-base vowel signs, and conjuncts into correct Unicode logical order.
3. **NFC normalization** — the final pass canonicalizes the output.
4. **Unmapped-sequence reporting** — anything the tables don't recognize is collected and surfaced to the user and to the failure log, rather than dropped or rendered as mojibake.

Mapping accuracy is **iteratively converging, not finished** — rare conjuncts and ambiguous legacy sequences are added as fixtures surface them. This is disclosed in the product itself; the app never claims "100% accurate" or "perfect conversion."

## Features

- **Text converter** (`/converter`) — live, debounced conversion with encoding auto-detect/override, copy/download/clear, and non-whitespace character counting against usage tiers.
- **Document processing** (`/documents`) — upload `.pdf` (via `unpdf`), `.docx` (via `mammoth`), `.txt`, or `.doc` (via `word-extractor`, explicitly best-effort — see [Problems we faced](#problems-we-faced-and-how-we-handled-them)). Extracted text flows through the exact same conversion engine as manual input.
- **Comparison/diff** (`/compare`) — word- and paragraph-level diff between two text or file inputs, with similarity scoring and a structured (non-HTML-string) diff result.
- **Usage tiers** — three free tiers gating characters per conversion, not features: Easy (3,000), Medium (6,000), Expert (25,000) non-whitespace characters. No payment gating exists behind any of them.
- **Accounts** — Email/Password and Google sign-in via Firebase Auth; enables saved conversion/comparison history. Not required to use the converter.
- **Failure log & feedback** — a visible log of every kind of conversion/extraction failure (client-side conversion errors, unmapped letters, server-side file-extraction failures), plus a feedback form (anonymous or signed-in) that writes to Firestore for triage.
- **Admin dashboard** (`/admin`) — internal-only surface: stats/analytics (Recharts), user management (tier, usage overrides, enable/disable), system config (tier limits, enabled encodings, upload size, feature flags), and an audit log of every admin mutation.
- **Accessibility** — a real Bengali webfont (Noto Sans Bengali) for correct shaping of conjuncts and matras, `prefers-reduced-motion` honored app-wide, skip link, landmark regions.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| UI primitives | Radix UI (dialog, select, tabs, tooltip, progress) |
| Motion | `motion` (Framer Motion successor), with `usePrefersReducedMotion` gating |
| Charts | Recharts (admin dashboard only, lazy-loaded) |
| Auth / DB / Storage | Firebase (client SDK + `firebase-admin` on the server) |
| Validation | Zod, at every Firestore read/write boundary |
| File extraction | `unpdf` (PDF), `mammoth` (DOCX), `word-extractor` (legacy DOC) |
| Diffing | `diff` (word/line diff, wrapped by a custom similarity engine) |
| Testing | Vitest |
| Linting | ESLint 9 (flat config) |

## Project structure

```
app/                     Next.js App Router routes and API handlers
  converter/              Text converter page
  compare/                 Comparison/diff page
  documents/               File upload & extraction page
  account/                 User history
  admin/                   Admin dashboard (server-gated layout)
  api/                     Route handlers (conversions, comparisons, documents,
                           admin/*, auth/session, error-logs, feedback, users/me)
features/                Feature-scoped logic paired with its own tests
  converter/               Conversion engine, encodings, constants
  comparison/               Diff/similarity engine
  documents/                 Extraction config
  usage/                     Tier config & usage enforcement
  landing/                    Landing-page specimen components
lib/
  firebase/                Client/admin SDK init, Firestore schemas (Zod), writers
  errors/                   Discriminated AppError / Result model, safe-response stripping
  security/                 Rate limiting
  auth/                     Session cookie + tier resolution
  log/                      Client-side conversion issue log (useSyncExternalStore)
  feedback/                 Client-safe feedback limits/constants
  motion/                   Motion tokens (durations/easings) used app-wide
  utils/                    Small shared helpers (cn, download, text)
components/               Presentational/UI components, grouped by feature
hooks/                    React hooks (one per concern, mostly thin wrappers over features/lib)
types/                    Shared TypeScript domain types
docs/firebase-setup.md    Step-by-step Firebase project setup
```

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The converter, comparison, and document-processing pages work immediately — **no Firebase project is required** to try the core product. Sign-in and saved history stay disabled until Firebase is configured (see below), and the app detects this and degrades gracefully rather than crashing.

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in values from a real Firebase project (see [`docs/firebase-setup.md`](docs/firebase-setup.md) for exact steps):

```bash
cp .env.local.example .env.local
```

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | Client SDK config (safe to expose to the browser) — API key, auth domain, project ID, storage bucket, messaging sender ID, app ID |
| `FIREBASE_ADMIN_PROJECT_ID` / `FIREBASE_ADMIN_CLIENT_EMAIL` / `FIREBASE_ADMIN_PRIVATE_KEY` / `FIREBASE_ADMIN_STORAGE_BUCKET` | Server-only Admin SDK service-account credentials — **never commit, never prefix with `NEXT_PUBLIC_`** |

Until these are set, `isFirebaseConfigured` / `isFirebaseAdminConfigured` both resolve to `false` and the app runs fine with sign-in/persistence disabled.

## Scripts

```bash
npm run dev         # start the dev server
npm run build       # production build
npm run start        # run the production build
npm run lint          # ESLint
npm run test           # run the test suite once (Vitest)
npm run test:watch      # run the test suite in watch mode
```

## Testing

The project has a fixture-driven Vitest suite (**192 tests** as of the last update) covering:

- The conversion engine (tokenizer, reorder pass, normalization, fixture-based encoding coverage for Bijoy and SutonnyMJ).
- The comparison/diff engine (similarity scoring, word/paragraph modes).
- Usage tier and server-side limit resolution.
- Firestore Zod schemas for every collection.
- The client-side conversion issue log (event identity, merge/dedupe, cap, snapshot stability).
- The rate limiter and its IP-extraction helper.

```bash
npm run test
```

## Security

- **Server-verified authorization everywhere.** Role/tier lives only in Firebase custom claims and server-verified profiles — never trusted from a client-supplied field. Every privileged API route calls `requireAdminUser` or `requireServerUser` and scopes queries to the caller's own UID.
- **Firestore/Storage rules** are default-deny, own-data-only, with admin/server-only collections (`usageOverrides`, `adminStats*`, `auditLogs`, `systemConfig`, `errorLogs`, `feedback`) that reject all client writes.
- **Rate limiting** on unauthenticated-reachable, expensive routes (file extraction, session creation) — fixed-window, in-memory (see [limitations](#known-limitations) for the multi-instance caveat).
- **Security headers**: a Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and HSTS in production.
- **Safe error responses**: every route funnels errors through a shared handler that strips debug payloads (stack traces, internal causes) before they reach the client; full detail is logged server-side only.
- **Audit log**: every mutating `/api/admin/*` action is recorded, viewable in the admin dashboard.

## Problems we faced (and how we handled them)

Building a font-encoding converter surfaces a specific, recurring category of problem: legacy Bengali "fonts" like Bijoy and SutonnyMJ are not Unicode fonts at all — they're glyph-substitution hacks laid over the Latin code page, so the *conversion logic*, not just the UI, has to reconstruct a linguistic structure that was never actually encoded in the source text. The concrete issues that came up:

- **No suitable rendering font for the actual glyphs.** The legacy encodings display correctly only with the original proprietary fonts (Bijoy, SutonnyMJ) installed, which are Windows-only, unlicensed for redistribution in most cases, and not web fonts. There is no way to render "what the user's raw file looks like" faithfully in a browser without those fonts. We resolved this by never trying to render the *legacy* bytes — the product only ever displays the **converted Unicode output**, set in [Noto Sans Bengali](https://fonts.google.com/noto/specimen/Noto+Sans+Bengali) (loaded via `next/font/google`, self-hosted at build time, no runtime font-loading flash). This sidesteps the missing-font problem entirely but means the product cannot offer a true "before" preview — only the after.
- **Correct Bengali shaping is a hard requirement, not a cosmetic one.** Bengali text needs a font and rendering stack that correctly forms conjuncts (যুক্তাক্ষর) and reorders matras (vowel signs) around the base consonant. A generic system sans-serif silently drops or misplaces these, which — for a product whose entire premise is "we fix broken Bengali" — would look like the tool itself was broken. Noto Sans Bengali was chosen specifically because it has full conjunct/matra coverage and is actively maintained by Google; it's loaded everywhere Bengali text can appear (converter, comparison, landing-page specimen), not just the primary output box.
- **Visual order vs. logical order.** Legacy Bengali keyboards type in *visual* order (the order glyphs appear on screen), but Unicode Bengali is stored in *logical* (phonetic) order. A byte-for-byte character remap without reordering produces text that looks almost right but is subtly wrong — reph appears in the wrong place, vowel signs that should precede the consonant they modify come out following it, and so on. This required an explicit reorder pass (reph, hasant/virama, pre-base vowel signs, conjuncts) after the raw character mapping, not just a lookup table.
- **Ambiguous and rare sequences don't have one correct answer.** Some legacy byte sequences are genuinely ambiguous outside of surrounding context, and rare conjuncts are numerous enough that no fixed-size table covers all of them at launch. Rather than guess and risk silently producing wrong Bengali (which is worse than an obvious failure, since it looks plausible), the engine explicitly **reports what it could not map** instead of best-effort-guessing. This is disclosed as a real, ongoing limitation — the mapping tables grow as new fixtures surface — rather than a bug to hide.
- **Legacy `.doc` extraction is unreliable in general.** The old binary `.doc` format doesn't have a single robust open-source extractor the way `.docx`/`.pdf` do. `word-extractor` gets most files right but not all. We decided a low-confidence `.doc` extraction should **fail loudly with a typed error** rather than hand the user silently mangled text they might not notice — consistent with the "disclose failure" principle applied everywhere else in the app.
- **The unmapped-sequence blind spot.** Early on, the biggest reporting gap wasn't errors — it was **successful-looking conversions that were still wrong**, because a user sees *some* Bengali come out and has no way to tell part of it was actually unmapped filler. The fix was to log unmapped sequences on the **success path** too (not just on outright failures), with sample sequences captured for triage, so this silent failure mode gets the same visibility as a hard error.
- **Firebase SDK bloat on public routes.** Importing the Firebase client SDK (and Firestore/Storage alongside Auth) at the top of the root layout pulled all of it into the first load of every route, including the public landing page that doesn't need Firestore/Storage at all. This was fixed by making the SDK accessors async and dynamically imported on demand, and by keeping the `diff` and `recharts` packages (used only by comparison and admin, respectively) out of the landing page's client bundle via server components.
- **A Turbopack/`firebase-admin` build issue.** `next build` under Turbopack fails to bundle `firebase-admin`'s Node-only dependencies (`child_process`, `dns`, gRPC) unless they're explicitly marked as server-external packages in `next.config.ts` (`serverExternalPackages: ["firebase-admin"]`). This is a known one-line fix, left for a deliberate config-changing step rather than folded silently into an unrelated feature change.

## Known limitations

Disclosed here rather than left implicit:

- **Mapping accuracy is iteratively converging, not finished.** Rare conjuncts and ambiguous legacy sequences are added as fixtures surface them.
- **No live Firebase project is wired up by default** — Phases involving auth/Firestore/Storage haven't been exercised against a real sign-in flow in a browser; check for CSP console violations the first time this runs against a live project.
- **`.doc` extraction is best-effort.** Unreliable extractions fail loudly rather than returning mangled text.
- **The rate limiter is in-memory and per-server-instance**, not a distributed guarantee — fine for a single-instance deployment, but a multi-instance deployment gets a per-instance ceiling rather than a global one. Move to a shared store (Redis, or a Firestore transaction counter) if that gap matters.
- **The CSP is pragmatic, not nonce-strict** (`'unsafe-inline'` on `script-src`/`style-src`), because Next.js's App Router streams hydration data through inline `<script>` tags and several components set inline `style` attributes. A nonce-based CSP would need per-request nonce plumbing through middleware and every layout.
- **There is no true "before" preview of the raw legacy-encoded text** (see [Problems we faced](#problems-we-faced-and-how-we-handled-them)) — only the converted Unicode output is rendered.

## Roadmap

- Final verification pass: full lint/typecheck/build/test sweep across the entire app.
- Apply the one-line `serverExternalPackages` fix to unblock `next build` under Turbopack.
- Continue expanding the Bijoy/SutonnyMJ fixture coverage as rare conjuncts and ambiguous sequences surface.
- Author a real (non-synthetic) demo sample for the landing page, ideally including one genuinely unmapped sequence, once mapping coverage is broad enough to do so honestly.
