# Conversion Failure Intelligence Pipeline

Status: **Phases 1–9 implemented** (failure capture, patterns, provider-agnostic AI resolution library, the server-side resolution service + admin API route that persists candidates into `aiResolutions`, the server-side admin accept/reject review workflow — see §7.4 — the system-wide invariant tests of §10, and the §9 admin UI). Both the list view (`/admin/conversion-failures`) and the pattern detail view (`/admin/conversion-failures/[patternId]`) ship, with working "Resolve with Gemini/OpenAI" and accept/reject controls wired through `hooks/useConversionFailureDetail.ts`.
Owner: conversion engine / admin tooling
Related: `docs/firebase-setup.md`, `lib/firebase/errorLog.ts`, `lib/firebase/feedback.ts`

## 1. Why

The conversion engine (`features/converter/engine/`) already does the hard part right: when
it can't map a legacy byte/character to Unicode, it never drops it, mangles it, or throws —
it passes it through unchanged and flags it (`Token.unmapped`), and `validate.ts` turns that
into a `ValidationResult` with grouped `unmappedDetails` (sequence, count, sample contexts).
Today that information is shown once — in the client-side `ConversionLogPanel` and the
admin `/admin/errors` page — and then it's gone. There's no durable, structured record a
human or a model could use later to actually fix the missing mapping rule.

This pipeline turns every real unmapped/failed conversion into a persistent, individually
identifiable record with enough context to diagnose it, optionally routes it through an
external AI provider for a **candidate** fix (never authoritative, never automatic), and
gives an admin a place to accept or reject that candidate. Verified fixes become new rows
in the relevant `encodings/<id>/map.ts` table by hand, through the normal PR process — this
system stops at "candidate," it never writes engine rules itself.

## 2. Non-goals

- Not a replacement for `errorLogs` / `ConversionLogPanel`. That stays exactly as-is — it's
  the lightweight, real-time, user-visible diagnostics feed. This pipeline is a separate,
  admin-only, deeper dataset purpose-built for the "fix the mapping table" workflow.
- Not an automatic-fix system. AI output is a candidate a human reviews; nothing here ever
  patches `EncodingDefinition.rules` or `postProcess` automatically.
- Not a general translation/OCR feature. The AI prompt is explicitly scoped to "what Unicode
  character(s) does this legacy byte sequence, in this legacy font/encoding, represent" —
  not "translate this text."

### 2.1 AI in the user conversion path (revised, Phase 2)

Recorded here so the documented design and the code agree.

- **There is no live AI call in the user conversion path.** Not "none yet" — none by
  design. It keeps cost and latency out of the path a user waits on, and the converter is
  pure and runs locally.
- A user may be served a **stored** resolution when the converter cannot convert a
  sequence. By default only `accepted` (human-reviewed) resolutions are served, clearly
  flagged as a fallback and never presented as authoritative.
- Unverified AI results are served **only** behind a feature flag that is **off by
  default**, and are labelled "AI-suggested, unverified".

Consequence for the code: the absence of a provider key is not what keeps AI out of the
conversion path, so nothing may come to depend on that. A populated `GEMINI_API_KEY` in a
developer's `.env.local` makes `isConfigured()` true and a real billable call reachable
from any path that asks for one — the guarantee has to hold in the code and be asserted by
a test, not rest on an empty env var.

## 3. Data model

Three new top-level Firestore collections, all server-written only (Admin SDK; client
writes are never permitted, matching every existing collection in this app):

### 3.1 `conversionFailures` — one document per individual failure occurrence

Never merged, never deduplicated away — every occurrence is retained (per the hard
requirement that failures are ground-truth observations, not noise to collapse). Analogous
to `errorLogs` but deliberately richer and admin-only, because it aggregates diagnostic
context across users.

> **Privacy bound (Phase 2).** An occurrence carries the failed sequence plus a bounded
> context window either side of it, and no other user content. The original implementation
> shipped the entire conversion input in `fullText` and the entire converted result in
> `engineOutput`; both are now uncollected. `lib/conversionFailures/occurrence.ts` is the
> single builder both capture paths use, so the bound cannot drift between them, and
> `POST /api/conversion-failures` drops these fields even when a stale client still sends
> them. See §6.

| Field | Type | Notes |
|---|---|---|
| `userId` | `string \| null` | Re-derived server-side from the verified token, like every other collection. Anonymous allowed. |
| `sessionId` | `string` | Client-generated `crypto.randomUUID()` (text path) or request-scoped id (document path). Groups multiple failures from one conversion attempt without a separate sessions collection. |
| `source` | `"text" \| "file" \| "comparison" \| "api"` | Matches `errorLogSchema.source`. |
| `encodingId` | `string \| null` | `EncodingDefinition.id`, or `null` if auto-detect failed before an encoding was chosen. |
| `engineVersion` | `string` | `CONVERSION_ENGINE_VERSION` at the time of failure (new, see §4). |
| `rulesHash` | `string \| null` | SHA-256 of the resolved encoding's `rules` array, for drift detection across engine changes. |
| `failureCategory` | enum | `unmapped_character \| invalid_encoding \| reorder_defect \| normalization_warning \| conversion_exception \| document_extraction_failure \| unknown` (§17 taxonomy). |
| `failedSequence` | `string` | The **exact** legacy sequence, byte-for-byte/char-for-char as received. Never trimmed, normalized, or replaced. |
| `codePoints` | `number[]` | `Array.from(failedSequence).map(c => c.codePointAt(0))` — computed, never invented. |
| `position` | `number \| null` | Character offset of the failure within the original input. |
| `contextBefore` / `contextAfter` | `string` | Bounded windows (`CONTEXT_WINDOW_CHARS`, capped by `maxContextLength`) around the failure. The only user content an occurrence carries. |
| `fullText` | `string` | **Retired.** Always `""` on documents written since the privacy bound; retained in the schema so pre-bound occurrences still parse on read. |
| `fullTextTruncated` | `boolean` | **Retired.** Always `false` on new documents. |
| `engineOutput` | `string \| null` | **Retired.** Always `null` on new documents. |
| `errorCode` | `string` | e.g. an `AppErrorCode`, or a pipeline-internal code for warnings that aren't `AppError`s. |
| `errorReason` | `string` | Human-readable. |
| `severity` | `"error" \| "warning"` | Matches existing severity concept. |
| `fileName` / `fileType` | `string \| null` | Present for `source: "file"`. |
| `route` | `string \| null` | API route, for server-captured failures. |
| `patternId` | `string` | FK into `failurePatterns` (see below). |
| `createdAt` | `string` (ISO) | Matches this codebase's "ISO string, not `Timestamp`" convention. |

### 3.2 `failurePatterns` — the dedup / cost-control key

Doc ID = deterministic `sha256("{encodingId}|{engineVersion}|{failedSequence}")` (see
`lib/conversionFailures/patternId.ts`), so upserts never race or double-create.

| Field | Type | Notes |
|---|---|---|
| `encodingId` | `string \| null` | |
| `engineVersion` | `string` | |
| `failedSequence` | `string` | |
| `failureCategory` | enum | |
| `occurrenceCount` | `number` | `FieldValue.increment(1)` per new occurrence. |
| `firstSeenAt` / `lastSeenAt` | `string` (ISO) | |
| `sampleOccurrenceIds` | `string[]` | Small capped list (e.g. 5) of recent `conversionFailures` doc IDs, for quick admin preview without a second query. |
| `status` | `"open" \| "resolved"` | Set to `resolved` only by an explicit admin action once a mapping-rule fix has shipped (manual, out of scope for this system to automate). |

### 3.3 `aiResolutions` — candidate fixes, never overwriting the original

| Field | Type | Notes |
|---|---|---|
| `patternId` | `string` | Resolution happens at the **pattern** level (not per-occurrence) — this is the cost/dedup control from §15. |
| `provider` | `"gemini" \| "openai"` | |
| `model` | `string` | e.g. `gemini-2.5-flash`, `gpt-4o-mini` — whatever's actually configured. |
| `promptVersion` | `string` | `CONVERSION_RESOLUTION_PROMPT_VERSION`, bumped whenever the prompt changes; part of the dedup key. |
| `engineVersion` | `string` | Added in Phase 6. Copied from the authoritative `FailurePattern`, never client-supplied — part of the dedup key so a resolution is never reused across an engine change. |
| `rulesHash` | `string \| null` | Added in Phase 6. Copied from the representative occurrence used to build the request (§7.2) — also part of the dedup key, so a rules edit that doesn't bump `engineVersion` still invalidates the cache. |
| `candidateConversion` | `string \| null` | Widened to nullable in Phase 6 to match `ConversionResolution.candidateConversion` — `null` is a real, meaningful "no usable candidate" outcome, never coerced into a guess. |
| `reasoningSummary` | `string \| null` | On a failed resolution attempt (§7.2), reused to hold a short safe error code (e.g. `"Resolution failed: provider_timeout"`) rather than adding a duplicate field — never the raw provider error or `debug` payload. |
| `confidence` | `"high" \| "medium" \| "low" \| "unknown"` | |
| `alternativeCandidates` | `string[]` | |
| `isCertain` | `boolean` | |
| `rawResponse` | `string \| null` | JSON-stringified, length-capped, kept for audit only — never trusted directly. |
| `status` | `"pending" \| "completed" \| "failed" \| "reviewed"` | |
| `reviewDecision` | `"accepted" \| "rejected" \| null` | |
| `reviewedBy` | `string \| null` | Admin uid. |
| `reviewedAt` | `string \| null` | |
| `reviewNote` | `string \| null` | |
| `createdAt` | `string` (ISO) | |

## 4. Engine versioning (new)

Nothing like this exists today — `EncodingDefinition.maturity` is a confidence flag, not a
version. Adds:

- `features/converter/engine/version.ts`: `CONVERSION_ENGINE_VERSION` (manually bumped
  string, e.g. `"1.0.0"`) and `computeRulesHash(encoding: EncodingDefinition): string`.
  Deliberately **not** Node's `crypto` module — `version.ts` is imported by `pipeline.ts`,
  which runs client-side (the text converter calls `convertLegacyText` directly in the
  browser via `hooks/useConversion.ts`), and Node core modules aren't available in a
  browser bundle. Uses a dependency-free FNV-1a 32-bit hash over the serialized rule table
  instead — a stable content fingerprint for drift detection, not a security-sensitive
  digest, so a lighter non-cryptographic hash is the right tool here. (Contrast with
  `lib/conversionFailures/patternId.ts` in §3.2, which is strictly server-only and does use
  real `crypto.createHash("sha256")`.)
- Both values flow into `ConversionOutput` (`pipeline.ts`) so every caller — client and
  server — gets them without extra plumbing, and every `conversionFailures` row records
  exactly which engine/rule-set produced it.

## 5. Failure classification

`classifyFailure(...)` in `validate.ts` maps existing signals to the §17 taxonomy:

- `Token.unmapped === true` → `unmapped_character`
- `detectEncoding` confidence below `MIN_DETECTION_CONFIDENCE` → `invalid_encoding`
- The Bengali dependent-vowel-without-base-consonant heuristic in `validateUnicodeOutput` →
  `reorder_defect`
- NFC-normalization mismatch → `normalization_warning`
- A Latin-typography byte that is also a real conjunct in the active table, in mixed
  Unicode/legacy input → `ambiguous_typography` (Phase 2, see below)

### 5.1 Source hygiene and the flag-don't-strip rule (Phase 2)

`engine/normalizeSource.ts` is the single pass over the *input*, run before tokenizing so
the engine, the offsets it reports, and the signals an admin reviews all come from one
place. Two rules govern it:

1. **Transform only what cannot be legitimate legacy data.** The BOM qualifies: U+FEFF is
   not a CP1252 code point and appears in zero rules across all three encodings, so it can
   only be transport noise. Almost nothing else qualifies.
2. **Otherwise flag, never change.** These tables address CP1252 bytes, and several of
   those bytes are Latin typography characters carrying real conjuncts:

   | byte | Bijoy meaning |
   |---|---|
   | U+2019 `'` | `্থ` (also ন্থ, ন্থ্র, স্থ) |
   | U+00AD soft hyphen | `্ল` (also গ্ল, প্ল, ব্ল, ল্ল, শ্ল, স্প্ল) |
   | U+201C `"` | `ু` (also রু) |
   | U+201D `"` | চ্চ, চ্ছ, চ্ছ্ব, চ্ছ্র, চ্ঞ, চ্ব |

   A "smart quotes" or "strip soft hyphens" cleanup — the kind most text pipelines apply by
   reflex — would silently destroy every স্থ and every ল-fola in the document. Note also
   that U+201C/U+201D are **not** a quote pair here: they are unrelated CP1252 0x93/0x94
   bytes, so their asymmetry is correct, not a defect.

A flag is raised only where the ambiguity is real: the input must mix already-converted
Unicode with legacy bytes. In a pure legacy document U+2019 is unambiguously ্থ, and
flagging it there would fire on virtually every real document — recreating exactly the
noise problem §5.2 removed. Signals are advisory: they never make a conversion invalid,
and the byte still converts to its conjunct.

**Not yet possible:** using font or per-run information to disambiguate. No extractor
exposes it — `features/documents/extract/types.ts` carries only `text`, `fileName`,
`fileType`, `pageCount` and `notes`. That would need extractor work first.

### 5.2 Noise the pipeline deliberately no longer records (Phase 2)

Three classes of report were unactionable by construction and are now suppressed at
source, so `failurePatterns` reflects real mapping gaps:

- **Already-Unicode input.** Legacy text is CP1252, so the tables contain no Bengali-block
  characters; pasting converted text made every Bengali letter an "unmapped character" —
  ~18 pattern rows from one short sentence. `detectAlreadyUnicode` now reports it as a
  no-op with one message.
- **Unfinished clusters.** The converter runs per debounced keystroke, so typing `wK` (কি)
  passes through `w` — a pre-base vowel with no consonant yet — which read as a reorder
  defect. `hasDanglingPreBaseVowel` exempts only that trailing run.
- **ZWJ/ZWNJ.** Not legacy bytes in any table, so they reported as unmapped — including
  the U+200C this converter emits itself for the visible hasant. Now passed through.
- A thrown/`AppError` `CONVERSION_ERROR` → `conversion_exception`
- `AppError` `FILE_PROCESSING_ERROR` → `document_extraction_failure`
- Anything else → `unknown`

## 6. Client and server capture paths

Two existing entry points, both already computing `ValidationResult` — this pipeline hooks
both rather than adding a third path:

1. **Text converter (client-side, synchronous).** `hooks/useConversion.ts` already produces
   a `ValidationResult` per keystroke (debounced). A new reporter (alongside
   `hooks/useIssueLog.ts`) posts detailed occurrences to `POST /api/conversion-failures`
   once per distinct pattern per session — fire-and-forget, `keepalive: true`, never blocks
   the UI, exactly like `lib/log/reportIssue.ts` already does for `errorLogs`.
2. **Document upload (server-side).** `app/api/documents/extract/route.ts` already has the
   extracted text and `validation.unmappedDetails` in memory after `convertDocument()`. It
   calls the repo function directly — no HTTP round trip — right next to its existing
   `capture()` call for `errorLogs`.

Both paths build their payload with `buildFailureOccurrence()` from
`lib/conversionFailures/occurrence.ts`. That function reads the source text only to slice
the context window; the text itself never enters the returned object, so neither path can
persist a whole document even by accident. Regression coverage:
`lib/conversionFailures/limits.test.ts` (builder) and
`app/api/conversion-failures/route.test.ts` (route).

In both cases, persistence is **best-effort and asynchronous relative to the conversion
result**: a Firestore outage never blocks or corrupts the conversion the user is looking at.

## 7. AI resolution — explicit, provider-abstracted, never automatic

The engine never talks to an AI provider. The full path, from an admin's click through to a
persisted candidate, is:

```
Admin (or API caller)
        │  POST /api/admin/conversion-failures/{patternId}/resolve
        │  body: { provider, includeContext?, includeFullText? } — nothing else is trusted
        ▼
requireAdminUser(request)                (lib/auth/session.ts)
        │  unauthenticated → 401 · authenticated non-admin → 403
        ▼
checkRateLimit(`ai-resolve:${uid}`)      (lib/security/rateLimit.ts — RESOLUTION_LIMITS.resolveRateLimit)
        ▼
resolveConversionFailure(...)            (lib/ai/resolveConversionFailure.ts — §7.2)
        │
        ├─ getResolutionProvider(id)             (lib/ai/registry.ts)
        │       unknown id → ProviderError "provider_not_registered", no fallback
        │
        ├─ getFailurePatternDetail(patternId)    (lib/firebase/conversionFailures.ts)
        │       not found → NOT_FOUND_ERROR · no usable occurrence → DATABASE_ERROR
        │
        ├─ build ConversionResolutionRequest server-side from the pattern +
        │  most-recent occurrence — a client only ever chose *which*
        │  pattern/provider, never *what* gets sent (lib/ai/types.ts)
        │
        ├─ claim the deterministic `aiResolutions` dedup/concurrency slot
        │       already completed  → reuse it, provider is never called again
        │       fresh pending claim → 409 CONFLICT_ERROR (a concurrent admin got there first)
        │
        ▼
ConversionResolutionProvider.resolve(request, options)
        │
        ├── not configured (no API key)  → ProviderError "provider_not_configured"
        │
        └── configured
              │
              ▼
        buildResolutionPrompt(request, options)   (lib/ai/promptBuilder.ts, versioned "v1")
              │   only sends failedSequence + code points by default;
              │   context/fullText only if options.includeContext / includeFullText is set
              ▼
        provider REST call (plain fetch, AbortController timeout)  (lib/ai/providers/*.ts)
              │   HTTP failure → normalized ProviderError (auth/rate-limit/timeout/unavailable/…)
              ▼
        parseProviderResponseText(providerId, rawText)   (lib/ai/responseSchema.ts)
              │   malformed/out-of-bounds → ProviderError "provider_invalid_response"
              ▼
        ConversionResolution   (normalized, provider-independent — lib/ai/types.ts)
              │
              ▼
        persist into `aiResolutions` (status: "completed", or "failed" on a provider error)
              │   write itself fails → DATABASE_ERROR, distinct from a provider failure —
              │   never reported as a success
              ▼
        { ok: true, resolution, reused }  →  200 JSON response (never the raw provider payload)
```

- **`lib/ai/types.ts`** — `ConversionResolutionRequest`, `ConversionResolution`,
  `ResolutionOptions`, and the `ConversionResolutionProvider` interface. Nothing here
  depends on Firestore, `fetch`, or a specific provider's SDK.
- **`lib/ai/registry.ts`** — `getResolutionProvider(id)` / `listResolutionProviders()`. The
  only place that maps a `ProviderId` to an adapter; callers never import
  `providers/gemini.ts`/`providers/openai.ts` directly.
- **`lib/ai/providers/gemini.ts`, `providers/openai.ts`** — plain `fetch` against each
  provider's REST API, no new npm dependency. Each reads its own key at module scope
  (`GEMINI_API_KEY`, `OPENAI_API_KEY`) and exposes `isConfigured()`, mirroring
  `lib/firebase/admin.ts`'s convention. Every module-level file that can see a key calls
  `assertServerOnly()` (see §8) before anything else runs.
- **`lib/ai/promptBuilder.ts`** — the only place prompt text is built.
  `CONVERSION_RESOLUTION_PROMPT_VERSION` (currently `"v1"`) is stamped onto every
  `ConversionResolution` so a stored result is reproducible/auditable later. The system
  instruction explicitly frames the task as legacy-encoding→Unicode analysis, not
  translation/summarization/spelling-correction, and asks for a short user-safe
  `explanation` only — never hidden chain-of-thought.
- **`lib/ai/responseSchema.ts`** — the only place a provider's raw JSON is trusted. Validates
  `candidateConversion` (bounded string or `null` — a real "no candidate" outcome is never
  coerced into a guess), `alternatives` (bounded array), `confidence`
  (`"low"|"medium"|"high"|null`), `isCertain` (boolean), `explanation` (bounded string or
  `null`). Anything that fails to parse becomes `provider_invalid_response` — nothing
  malformed ever reaches a caller.
- **`lib/ai/errors.ts`** — the normalized `ProviderErrorCode` taxonomy (`provider_not_registered`,
  `provider_not_configured`, `provider_authentication_failed`, `provider_rate_limited`,
  `provider_timeout`, `provider_unavailable`, `provider_invalid_response`,
  `provider_content_rejected`, `provider_unknown_error`). `debug` never crosses to a client —
  see `toSafeProviderError`.
- A third provider type (`search_ai`) is defined in the taxonomy but **not implemented** —
  no supported, ToS-compliant programmatic "AI search answer" API was identified during
  design. Per the spec's own instruction, an unsupported integration is marked as such
  rather than built as a scraping workaround. `ProviderId` in `lib/ai/types.ts` is exactly
  `"gemini" | "openai"`; asking the registry for `"search_ai"` returns a controlled
  `provider_not_registered` error.

### 7.2 Phase 6 — the resolution service and API route

`lib/ai/resolveConversionFailure.ts` is the only module that turns a stored `FailurePattern`
into a real provider call and a persisted `aiResolutions` document — it's also the only
`lib/ai/*` module that imports `lib/firebase/*`; everything upstream of it stays
Firestore-independent by design (§7's library, built in Phase 5).

- **Endpoint.** `POST /api/admin/conversion-failures/[patternId]/resolve`
  (`app/api/admin/conversion-failures/[patternId]/resolve/route.ts`). The request body is
  minimal and validated with zod: `provider` (must be one of `SUPPORTED_PROVIDER_IDS` — an
  unknown provider is rejected outright, never silently falls back to a default) plus optional
  `includeContext`/`includeFullText` booleans. Every other field a resolution needs
  (`encodingId`, `failedSequence`, `engineVersion`, `rulesHash`, timestamps, classification) is
  loaded from Firestore server-side and is never accepted from the client, even if present in
  the body.
- **Authentication/authorization.** `requireAdminUser(request)` (`lib/auth/session.ts`) — the
  same admin-claim check every other `/api/admin/*` route uses, no parallel auth system.
  Unauthenticated → `401`; authenticated but not an admin → `403`; a client-supplied `isAdmin`
  field is never consulted.
- **Provider selection.** `getResolutionProvider(providerId)` (`lib/ai/registry.ts`, §7) — the
  persisted resolution always records the provider's actual configured `model` id, read from
  the adapter rather than hard-coded, so a persisted row is honest about exactly what produced
  it even after a model is reconfigured.
- **Representative occurrence.** A pattern can have many occurrences; occurrence-level fields
  that a `FailurePattern` itself doesn't carry (`rulesHash`, context, `fullText`, `position`,
  `engineOutput`) come from the single most-recently-seen occurrence
  (`getFailurePatternDetail` already orders occurrences newest-first) rather than an arbitrary
  sample, since two occurrences of the same pattern can in principle carry a different
  `rulesHash` (a rules edit that didn't bump `engineVersion`).
- **Privacy defaults.** The request built for the provider includes only `failedSequence` +
  `codePoints` by default — `contextBefore`/`contextAfter`/`fullText` are attached only when
  `includeContext`/`includeFullText` is explicitly `true` in the (server-validated) request
  body; a client cannot smuggle a broader default past this.
- **Deduplication & concurrency.** The entire mechanism is one deterministic `aiResolutions`
  document ID: `sha256(patternId|provider|model|promptVersion|engineVersion|rulesHash)`
  (`computeResolutionKey`), mirroring `failurePatterns`' own content-hash doc ID (§3.2). Two
  resolutions are "the same" exactly when all six inputs match — a new provider, a
  reconfigured model, a bumped prompt version, a new engine version, or rules-hash drift each
  land on a different document, so an incompatible resolution is never reused. Before calling
  a provider, a Firestore transaction atomically claims that document: a missing, malformed,
  `"failed"`, or stale (`RESOLUTION_LIMITS.pendingClaimTimeoutMs`, 60s) `"pending"` slot is
  claimable and proceeds to call the provider; an existing `"completed"` slot is returned
  directly with `reused: true` and the provider is never called; a *fresh* `"pending"` slot
  (a concurrent admin request already in flight) returns `409 CONFLICT_ERROR` instead of
  triggering a second paid call for the same key.
- **Persistence.** Uses the existing `aiResolutions` schema's exact field names (§3.3) — no
  redesign. `promptVersion` comes from Phase 5's `CONVERSION_RESOLUTION_PROMPT_VERSION`
  (never re-typed by hand); `engineVersion`/`rulesHash` come from the authoritative
  `FailurePattern`/occurrence data, never the client. `confidence` is bridged from
  `ConversionResolution.confidence` (`"low"|"medium"|"high"|null`) to the Firestore enum
  (`"high"|"medium"|"low"|"unknown"`) by one explicit function,
  `mapResolutionConfidence()` (`lib/ai/confidenceMapping.ts`) — no `as` casts, every input
  value covered and tested. `rawResponse` stays `null`, continuing Phase 5's policy of never
  persisting raw provider response bodies.
- **Failure behavior.** A provider error still writes an `aiResolutions` document — with
  `status: "failed"` and a short safe code in `reasoningSummary` (e.g.
  `"Resolution failed: provider_timeout"`, never the raw provider error or `debug` payload) —
  so "never attempted" and "attempted but failed" stay distinguishable in the data. Every
  `ProviderErrorCode` from Phase 5 (§7) maps to a precise `AppErrorCode`/HTTP status rather
  than a generic 500 (e.g. `provider_rate_limited` → `429`, `provider_content_rejected` →
  `400`, everything else provider-side → `500` since it isn't the caller's fault). If the
  Firestore write itself fails *after* a successful AI response, that's reported as a distinct
  `DATABASE_ERROR` ("the AI provider produced a result, but it could not be saved") — never a
  false success, and no automatic retry loop.
- **No engine impact.** The resolution is a candidate row in `aiResolutions` only — this phase
  never touches `EncodingDefinition.rules`, `postProcess`, `reorder` rules, or otherwise
  changes conversion behavior.

### 7.3 What's intentionally not built

- **A provider-configured affordance in the admin UI.** The "Resolve with Gemini/OpenAI"
  buttons in §9 are always enabled; a provider with no API key configured is rejected
  server-side with a clear `provider_not_configured` error rather than being greyed out up
  front. Disabling the button would need an endpoint that reports which providers are
  configured, which does not exist. The server-side rejection is the guarantee; the button
  state is only an affordance.
- **Any automatic engine-rule generation.** An accepted AI candidate never becomes a
  `map.ts`/`EncodingDefinition.rules` change by itself — per §2/§10, that stays a normal,
  human-reviewed code change even with Phase 7's accept/reject action in place. Accepting a
  candidate records that an admin judged it correct; it does not change what the conversion
  engine does.

### 7.4 Phase 7 — human review (accept/reject)

`lib/ai/reviewConversionResolution.ts` is the only module that turns an admin's accept/reject
decision into a Firestore write. Like `resolveConversionFailure.ts` (§7.2), it's one of only
two `lib/ai/*` modules that import `lib/firebase/*`; the review workflow never reaches into
the provider layer (`lib/ai/providers/*`, `lib/ai/registry.ts`) at all — reviewing a candidate
never calls Gemini/OpenAI again.

- **Endpoint.** `POST /api/admin/conversion-failures/[patternId]/review`
  (`app/api/admin/conversion-failures/[patternId]/review/route.ts`). The request body is
  minimal and validated with zod: `resolutionId` (which `aiResolutions` document is being
  reviewed), `decision` (`"accepted" | "rejected"`), and an optional bounded `reviewNote`
  (`RESOLUTION_LIMITS.maxReviewNoteLength`, 500 chars). Nothing else is accepted from the
  client — in particular, `candidateConversion`, `provider`, `model`, `confidence`,
  `engineVersion`, `rulesHash`, and any other field already on the resolution are never
  read from the request body, even if present.
- **Reviewer identity.** Always `requireAdminUser(request)`'s verified `uid`
  (`lib/auth/session.ts`) — the same admin-claim check every other `/api/admin/*` route uses.
  A client-supplied `reviewedBy`, `isAdmin`, `role`, or `userId` field is never consulted; the
  route only ever reads `resolutionId`/`decision`/`reviewNote` out of the parsed body.
  Unauthenticated → `401`; authenticated but not an admin → `403`. `reviewedAt` is likewise
  always a server-generated timestamp (`new Date().toISOString()` at transaction-commit time),
  never client-supplied.
- **State machine.** Reuses the existing `aiResolutions.status`/`reviewDecision` fields (§3.3)
  rather than inventing a parallel one:

  | `status` | `reviewDecision` | Review state | Reviewable? |
  |---|---|---|---|
  | `"pending"` | `null` | not yet resolved | no — `409` |
  | `"failed"` | `null` | resolution attempt failed, no candidate | no — `409` |
  | `"completed"` | `null` | candidate ready | **yes** — pending review |
  | `"reviewed"` | `"accepted"` | accepted | terminal |
  | `"reviewed"` | `"rejected"` | rejected | terminal |

  Only `"completed"` (pending review) accepts a decision and transitions to
  `"reviewed"`/`"accepted"` or `"reviewed"`/`"rejected"`. Both `"reviewed"` states are
  terminal — reviewing an already-reviewed resolution never silently re-applies a new
  decision.
- **Idempotency vs. conflict.** Re-submitting the **same** decision against an already-`"reviewed"`
  resolution is treated as an idempotent success: the route returns `200` with
  `alreadyReviewed: true` and the *original* stored record (original `reviewedBy`/`reviewedAt`/
  `reviewNote` untouched — a second reviewer's note is never silently applied over the first's).
  Re-submitting a **different** decision against an already-`"reviewed"` resolution (e.g.
  accept → reject) is a genuine conflict and returns `409 CONFLICT_ERROR` without changing the
  stored record. A resolution that isn't reviewable yet (`"pending"`/`"failed"`) also returns
  `409 CONFLICT_ERROR`, since there's no candidate to accept or reject.
- **Resource validation.** `resolutionId` must both exist and belong to `patternId`
  (`resolution.patternId !== input.patternId` is checked inside the transaction, §3.3). A
  mismatched or unknown `resolutionId` fails exactly like "not found" (`404`) — the response
  never confirms that a given `resolutionId` exists under some *other* pattern.
- **Concurrency.** One Firestore transaction (`applyReviewTransaction`) reads the current
  document, re-derives its review state, and writes the decision atomically — the same
  read-confirm-write shape Phase 6 uses for its dedup claim (§7.2). Two admins racing the same
  pending resolution both enter the transaction, but only the first commit observes
  "pending review"; Firestore's transaction retry serializes the second, which then lands on
  either the idempotent-success path (same decision) or the conflict path (different
  decision) above — never a silent overwrite of the first admin's decision.
- **Data preservation.** Accepting or rejecting only ever sets `status`, `reviewDecision`,
  `reviewedBy`, `reviewedAt`, and `reviewNote` on the existing `aiResolutions` document — every
  other field (`candidateConversion`, `provider`, `model`, `promptVersion`, `engineVersion`,
  `rulesHash`, `confidence`, `alternativeCandidates`, `isCertain`, `rawResponse`, `createdAt`,
  …) is carried through byte-for-byte unchanged. The review updates the existing document in
  place; it never creates a second `aiResolutions` record for the same candidate, and the
  original AI output is never edited or replaced — a rejected candidate stays in Firestore
  exactly as the provider produced it, as permanent evidence.
- **What acceptance does NOT do.** Accepting a candidate is purely a record of human judgment.
  It does not call `EncodingDefinition.rules`, `postProcess`, or any file under
  `features/converter/engine/**`; it does not queue, schedule, or trigger any follow-up job;
  and it does not change what the conversion engine outputs for any future input. Per §2/§10,
  turning a verified fix into an engine change stays a normal, human-authored, reviewed code
  change to `features/converter/encodings/*/map.ts` — this endpoint only records that an admin
  looked at a candidate and made a call.
- **Firestore rules.** No `firestore.rules` change was needed — `aiResolutions` was already
  `allow read: if isAdmin(); allow write: if false;`, and the review write goes through the
  Admin SDK server-side exactly like every other write in this pipeline.
- **Security.** Errors are mapped through the same `toSafeResponse`/`logAppError` path as every
  other admin route — no provider API keys, raw provider payloads, `fullText`/context, or stack
  traces ever reach the response body or a log line. A successful review writes one
  `lib/firebase/audit.ts` entry (`action: "conversionFailure.review"`) recording the actor uid,
  `patternId`, `decision`, and whether it was idempotent; a failed review (404/409/etc.) writes
  no audit entry.

## 8. Security & cost controls

`lib/ai/assertServerOnly.ts` gives technical (not just doc-comment) enforcement that a
provider/registry module never runs in a browser: every file in `lib/ai/providers/*.ts` and
`lib/ai/registry.ts` calls `assertServerOnly(moduleName)` at module scope, which throws if
`typeof window !== "undefined"`. The npm `server-only` package was evaluated and rejected —
its conditional exports only no-op inside Next's own webpack build; under plain Node/Vitest
it throws unconditionally on import, which would have broken unit testing these modules with
mocked `fetch`. The custom guard gives the same "never runs in a browser" property while
staying testable. See `lib/ai/__tests__/security.test.ts` for the enforcement tests (guard
throws under a simulated `window`, and no client-reachable directory references
`GEMINI_API_KEY`/`OPENAI_API_KEY` or imports a provider module).

- `conversionFailures`/`failurePatterns`/`aiResolutions` are **admin-only read** in
  `firestore.rules` (stricter than `errorLogs`' owner-or-admin, because these collections
  contain full document text). Write is always `false` — everything goes through the Admin
  SDK server-side.
- `POST /api/conversion-failures` is rate-limited like `/api/error-logs` (`checkRateLimit`),
  caps the number of failures accepted per request (`MAX_FAILURES_PER_REPORT`), and never
  trusts client-supplied `userId`/severity/timestamps.
- `POST /api/admin/conversion-failures/{patternId}/resolve` is admin-only
  (`requireAdminUser`) and rate-limited per admin uid
  (`RESOLUTION_LIMITS.resolveRateLimit`: 20 calls / 10 minutes), since each call can cost
  real money.
- `POST /api/admin/conversion-failures/{patternId}/review` is likewise admin-only
  (`requireAdminUser`) and rate-limited per admin uid
  (`RESOLUTION_LIMITS.reviewRateLimit`: 60 calls / 10 minutes — looser than `resolveRateLimit`
  since a review only writes to Firestore and never calls a paid provider, but still bounded
  to blunt scripted abuse). Reviewer identity (`reviewedBy`) and the review timestamp
  (`reviewedAt`) are always server-derived from the verified admin session, never from the
  request body (§7.4).
- AI resolution is keyed at the **pattern** level and deduplicated by
  provider+model+promptVersion+engineVersion+rulesHash (§7.2's `computeResolutionKey`), so
  the same failure seen thousands of times costs at most one AI call per key, not thousands.
- If a provider's API key isn't configured, `resolveConversionFailure` gets
  `provider_not_configured` from the adapter and the route returns a clear, safe "not
  configured" error — never a crash, never a leaked key. The §9 admin UI surfaces that error
  rather than disabling the button up front (see §7.3); the server-side rejection is the
  guarantee either way.

## 9. Admin UI

- `/admin/conversion-failures` — list of failure patterns (stat tiles: total patterns, total
  occurrences, resolved count; filters by encoding/category/severity), modeled on the
  existing `AdminErrorLog` route→hook→component triad. Explicit empty state before any data
  exists.
- `/admin/conversion-failures/[patternId]` — pattern detail: recent occurrences (full
  text/context, collapsed by default), all AI resolutions per provider, "Resolve with
  Gemini/OpenAI" actions, and accept/reject controls, calling
  `POST .../[patternId]/resolve` (§7.2) and `POST .../[patternId]/review` (§7.4) through
  `hooks/useConversionFailureDetail.ts`.

Raw legacy byte sequences (`failedSequence`, `fullText`, the context windows) are set in the
mono face throughout both views, and only genuinely converted Unicode — `engineOutput`,
`candidateConversion`, the alternatives — is set in Noto Sans Bengali and marked `lang="bn"`.
Noto Sans Bengali has no glyphs for the Latin-1 code points a legacy sequence is made of, so
setting bytes in it produces an unpredictable system fallback in the one panel whose whole
job is making those bytes legible.

## 10. What this system deliberately does NOT do

These three are enforced, not just documented: `lib/ai/__tests__/invariants.test.ts` asserts
each one, mirroring what `lib/ai/__tests__/security.test.ts` does for §8. The per-module unit
tests prove each piece behaves correctly today; these prove the system-wide guarantees survive
a later change to any of those pieces — including the §9 admin UI.

- It does not overwrite `engineOutput` or the original `failedSequence` with an AI
  candidate — both live side by side, permanently, so a wrong AI answer is just as visible
  as a right one. *Enforced by:* `aiResolutionSchema` having no field either value could be
  written into; an accept/reject leaving the seeded `conversionFailures`/`failurePatterns`
  documents byte-for-byte unchanged; a review opening no collection but `aiResolutions`; and
  no shipped `lib/ai/*` module naming either evidence collection as a write target.
- It does not automatically send full document text to Gemini/OpenAI, even though full text
  is stored in Firestore — storage and third-party transmission are treated as separate
  exposure surfaces. *Enforced by:* asserting at the HTTP boundary — the actual `fetch` body
  each adapter puts on the wire — that a request carrying `fullText`/context sentinels
  transmits none of them under default options, and all of them only on an explicit
  `includeContext`/`includeFullText` opt-in.
- It does not automatically edit `features/converter/encodings/*/map.ts`. A verified fix
  becomes a normal, reviewed, tested code change — this pipeline only produces the evidence
  and the candidate that motivates it. *Enforced by:* hashing every `map.ts` before and after
  an accept and requiring them unchanged, plus a static check that no shipped module under
  `lib/ai/**` or `app/api/admin/conversion-failures/**` imports a filesystem module or
  references `features/converter/encodings` at all.
