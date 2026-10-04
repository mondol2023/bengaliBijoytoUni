# Fallback pipeline — production readiness

Status: **prepared, not rolled out.** Neither rollout switch is enabled anywhere in this
repository, and nothing here changes the Vercel project. Written 2026-10-04 for the
"Phase 7 — Controlled Rollout" brief. That brief's "Phase 7" is **not** `legacy2uni.md`'s
Phase 7 (verification, already done); this file avoids the number for that reason.

Companion: [`rollout-canary-and-rollback.md`](rollout-canary-and-rollback.md) — the stages, and
how to undo each one. Phase 8 added [`rollout-operations.md`](rollout-operations.md): the
approval matrix, the full propagation timing, runnable stage checks, the observability gaps
and a per-site log classification.

## 1. Baseline

| | |
|---|---|
| Repository | `convert2uni/`, branch `feat/font-conversion-hardening` |
| Starting HEAD | `c8dc10b`. The brief named `7b4db7d`; eight commits landed after it (`f34666a`..`c8dc10b`: the stale-doc fixes, legacy2uni Phase 7 verification, anonymous visitor labels + report outbox). |
| Working tree at start | Four files with the owner's own uncommitted edits (`components/documents/DocumentUploadWorkspace.tsx`, `docs/conversion-failure-pipeline.md`, `firestore.rules`, `hooks/useDocumentConversion.ts`). Never staged by this work; the owner committed them as `e77c9f2` ("uup1") during it. None is part of this work. |
| Topology | Vercel, serverless, multi-instance. Every in-memory structure is per instance; shared state is Firestore. |
| Framework | Next.js 16 (App Router), React 19, Node runtime for every route below. |

### Entry points

| What | Where | Runs in |
|---|---|---|
| Conversion engine | `convertLegacyText` — `features/converter/engine/pipeline.ts` | browser and server |
| Converter wiring | `useConversion` — `hooks/useConversion.ts` | browser |
| Pipeline switch, as pure functions | `computeConversion`, `snapshotRequest` — `features/converter/fallbackPipeline.ts` | browser |
| Fallback pipeline | `runConversion`, `resolutionMapFrom` — `features/converter/runConversion.ts` | browser |
| Snapshot fetch | `loadResolutionSource` — `features/converter/resolutionSource.ts` | browser |
| Rendering | `ConversionOutputText`, `FallbackSummary` — `components/converter/ConversionOutputText.tsx`; "this is wrong" — `FallbackReportControl.tsx` | browser |
| Public snapshot | `GET /api/conversion-failures/known` — selection in `lib/conversionFailures/selectResolutions.ts`, `publishable.ts` | server |
| Failure reports | `POST /api/conversion-failures` (fed by `hooks/useConversionFailureReporter.ts` through the localStorage outbox) | server |
| Session issue reports | `POST /api/error-logs` (fed by `lib/log/reportIssue.ts`) | server |
| AI resolution (admin) | `POST /api/admin/conversion-failures/[patternId]/resolve` → `lib/ai/resolveConversionFailure.ts` | server |
| Review (admin) | `POST /api/admin/conversion-failures/[patternId]/review` | server |
| Re-verification (admin) | `POST /api/admin/conversion-failures/reverify` → `lib/firebase/reverifyPatterns.ts` | server |

The document upload path (`/api/documents/extract`) calls the engine directly and does not use
the fallback pipeline under either switch.

## 2. The two rollout switches

Both are parsed by `isTruthy` in `lib/conversionFailures/serveFlags.ts`: the value is
trimmed and lower-cased, and only `1`, `true`, `yes`, `on` mean on. Unset, empty,
whitespace, `false`, `0`, `off`, `no`, typos (`ture`) and anything else mean off.

| | `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` | `SERVE_UNVERIFIED_AI` |
|---|---|---|
| Read by | `isFallbackPipelineEnabled()`, called in `hooks/useConversion.ts` | `isServeUnverifiedAiEnabled()`, called in `app/api/conversion-failures/known/route.ts` (snapshot build) and as `runConversion`'s default |
| Where it takes effect | browser | server |
| When it is read | **build time** in the browser: the literal `process.env.NEXT_PUBLIC_…` is inlined into the client bundle | **per request** on the server. In the browser it is always off, because a non-`NEXT_PUBLIC_` variable never reaches a client bundle. |
| Default | off (unset in both `.env*.example` templates; pinned by `serveFlags.test.ts`) | off (unset in `.env.local.example`) |
| On, it does | converter fetches the snapshot once per encoding and renders accepted fallbacks, marked and labelled `FALLBACK_ACCEPTED_LABEL`, with a breakdown line and a "this is wrong" control | the public snapshot also carries `completed` but unreviewed AI candidates, each labelled `AI_UNVERIFIED_LABEL` in the payload |
| To disable | unset (or set to anything not truthy) **and rebuild + redeploy** | unset **and redeploy** (no code change; Vercel applies env changes only to new deployments) |
| Needs a deployment to change | yes — a new build | yes — a new deployment. "Runtime" here means read per request, not changeable without a deploy. |
| Independent of the other | yes — `rolloutMatrix.test.ts` runs every on/off value pair | yes — same file |

Vercel: "Any change you make to environment variables are not applied to previous
deployments, they only apply to new deployments." (vercel.com/docs/environment-variables,
checked 2026-10-04).

### What each combination makes visible

Pinned by `app/api/conversion-failures/known/rolloutMatrix.test.ts`, which drives the real
route, the client functions and the output component for every combination:

| Pipeline | Unverified | Public API payload | Converter fetches snapshot | Converter renders |
|---|---|---|---|---|
| OFF | OFF | accepted resolutions only | no | the pre-Phase-6 output, byte-identical markup |
| ON | OFF | accepted only | yes | accepted fallbacks marked; other gaps as raw bytes |
| OFF | ON | accepted **and unverified (labelled)** | no | the pre-Phase-6 output |
| ON | ON | accepted **and unverified (labelled)** | yes | accepted fallbacks marked; unverified ones **still raw bytes** |

Two consequences the brief's matrix did not anticipate:

1. **`GET /api/conversion-failures/known` is public whatever the pipeline switch says.** With
   `SERVE_UNVERIFIED_AI` on, unreviewed AI text is readable by anyone with a plain GET, even
   with the pipeline off.
2. **"Full experimental" (both on) does not render unverified text in the converter.**
   `runConversion` reads `SERVE_UNVERIFIED_AI` by a computed key, which is off in every
   browser, and refuses unverified entries client-side. Making them render would need a code
   change (a `NEXT_PUBLIC_` flag, or the server telling the client). That is a trust decision
   and is listed under approvals, not made here.

Copy, Download and Save to history always use the engine's own output, under every
combination. A fallback is shown on the page, never written into what the user takes away.

## 3. Persistence

| Concern | Collection / document | Written by | Retention |
|---|---|---|---|
| Failure occurrences | `conversionFailures/{autoId}` | `POST /api/conversion-failures` | `expireAt` 90 days, **inert until the TTL policy exists** (pending-manual-steps §1) |
| Failure patterns | `failurePatterns/{sha256(encoding\|engine\|sequence)}` | same, transactionally | `expireAt` 365 days sliding; same caveat |
| AI resolutions | `aiResolutions/{resolutionKey}` | admin resolve / review routes | never expires (no `expireAt`, by design) |
| AI daily budget | `aiCallBudget/{yyyy-mm-dd}` (UTC) — `{ count, expireAt }` | `lib/ai/costCap.ts` via `lib/firebase/sharedCounter.ts` | `expireAt` 35 days after the reservation; TTL policy pending |
| Rate-limit windows | `rateLimitWindows/{sha256(key)[:40]}_{windowStart}` — `{ count, expireAt }` | `lib/security/sharedRateLimit.ts` via `sharedCounter.ts` | `expireAt` = window end; TTL policy pending |
| Re-verification state | no collection of its own: the sweep writes only `failurePatterns.status` (`open`/`resolved`), plus an `auditLogs` entry for the admin route | `lib/firebase/reverifyPatterns.ts` | follows the pattern |
| Anonymous labels | `anonymousVisitors/{visitorId}`, `anonymousVisitorCounter` | `lib/firebase/anonymousVisitors.ts` | — |
| Session issue reports | `errorLogs` | `POST /api/error-logs` | — |
| "This is wrong" reports | `feedback` (category `wrong_conversion`) | the ordinary feedback form | — |

The fallback pipeline itself writes nothing. It reads one public snapshot.
`resolutionHits.ts` (batched `hitCount` increments) exists and is tested but **is not wired
into any route**, so `hitCount` never moves in production and snapshot ranking falls back to
`lastUsedAt`, then `lookupKey`.

## 4. Production configuration checklist

**The Vercel dashboard values cannot be verified from this repository.** Nothing below
claims production is configured. Each row says what to set, and how to check it from outside
without dashboard access.

### Both switches, per stage (Production environment)

| Stage | `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` | `SERVE_UNVERIFIED_AI` |
|---|---|---|
| Safe / default (Stage 0) | unset | unset |
| Controlled canary (Stages 1–2) | `true` | unset |
| Full experimental (Stage 3, owner approval only) | `true` | `true` |

Set them for **Production** only, and check the **Preview** environment separately. A
Preview deployment with the pipeline on is a public URL too.

### Everything else the pipeline depends on

| Variable | Needed for | If wrong |
|---|---|---|
| `FIREBASE_ADMIN_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY` | snapshot reads, shared counters | snapshot answers empty (pipeline renders nothing); rate limits fall back to per-instance |
| System env vars exposed (`VERCEL=1`) | `getRequestIp` uses `x-vercel-forwarded-for` | IP falls back to `x-forwarded-for`, then `x-real-ip`, then unknown; unknown is never shared |
| `AI_RESOLUTION_ENABLED` | admin resolve calls at all | independent of both switches |
| `AI_DAILY_CALL_BUDGET` | daily call ceiling (default 100) | invalid or zero values refuse every call (fails closed) |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | the provider | `provider_not_configured` |

### Checking production from outside

- **`SERVE_UNVERIFIED_AI`:** `GET /api/conversion-failures/known?encodingId=bijoy` → any
  `"verification":"unverified"` entry means it is on. No such entry is evidence only if at
  least one completed-but-unreviewed resolution exists for that encoding.
- **Pipeline:** open the production converter, paste Bijoy text, and watch the network panel.
  A request to `/api/conversion-failures/known` means the bundle was built with the pipeline
  on. None means off. For a local build of the same commit, `npm run check:client-flags`
  reads both flags out of `.next/static` (`scripts/checkClientFlags.mjs`).
- **The `known_snapshot_built` log line** (§5) reports `serveUnverified` on every build.

### Manual steps that should precede Stage 1

Existing, from `docs/pending-manual-steps.md`, still open as far as the repository can tell:
the four TTL policies (§1), the composite indexes (§2), and the copy review (§3). Its
`FALLBACK_ACCEPTED_LABEL` item, the one that had to come before Stage 1, was approved in
Phase 9 (`release-record-phase9.md`). Stage 1 is the first stage
that renders that label to readers. `.env.local.example` already says "Do not turn on before
the copy … is approved."

## 5. Observability

No new vendor. Two transports that already exist: `logAppError` (`console.error`, one line per
error, with `route`) and structured JSON lines on stdout (the `writeMetrics.ts` convention).
Both land in Vercel runtime logs and in any log drain.

### Added by this work

| Commit | Signal | Where |
|---|---|---|
| `0a0240a` | `{"metric":"known_snapshot_built", encodingId, engineVersion, serveUnverified, patterns, resolutionsAccepted, resolutionsUnverified}` — one per snapshot build (≤ 1 per cache key per minute per instance) | runtime logs, filter `known_snapshot_built` |
| `164c9f9` | A fallback pipeline that throws degrades to the pipeline-off output and reports `FALLBACK_PIPELINE_ERROR` once per tab per encoding: fixed message, no samples | `errorLogs` (admin → errors), via the existing `/api/error-logs` contract |
| `c9068f8` | Privacy fix: a 200 provider response with no readable text no longer logs its body, only its top-level keys and enum finish/block reason | resolve route logs |

### Already present, and what each answers

| Question | Signal |
|---|---|
| How often does the pipeline run? | Request count for `/api/conversion-failures/known` in Vercel request logs. This is a **lower bound**, because responses are `Cache-Control: public, max-age=60, stale-while-revalidate=300` and repeats within that window may never reach the function. |
| Does fallback processing throw? | `FALLBACK_PIPELINE_ERROR` rows in `errorLogs` (new, above) |
| What is it able to serve? | `known_snapshot_built` counts (new, above) |
| Failure categories, open vs resolved | `/admin/conversion-failures` (failureCategory filter, open/resolved tiles) |
| Readers disputing a fallback | `feedback` rows, category `wrong_conversion`, prefilled by "this is wrong" |
| Rate-limit refusals | `[RATE_LIMIT_ERROR] Too many requests…` with `route` (logged by `failResponder` on every refusal, local or shared) |
| Shared-counter / Firestore transaction failures | `[DATABASE_ERROR] Shared rate-limit check failed; the per-instance limit was applied instead.` |
| AI budget exhausted | `[RATE_LIMIT_ERROR] This deployment's daily limit of N AI calls is used up for <day> (UTC).` on the resolve route |
| AI budget counter unreachable | `[UNKNOWN_ERROR] The AI call budget could not be checked, so no call was made.` on the resolve route |
| Reverify failures | `logAppError` lines with `route: api/admin/conversion-failures/reverify`; successful runs are in `auditLogs` (`conversion_failure_reverify`, with examined/resolved/reopened counts) |
| Firestore write volume | `{"metric":"firestore_writes", …}` lines; `GET /api/admin/write-metrics` |

### Not measured, and why

**Per-conversion counts of `fallback_accepted`, `fallback_unverified` and `unresolved`
segments.** These exist only in the browser. Getting them to the server needs a new client →
server beacon (a new endpoint, or new fields on an existing one). That is an API-contract
change, and under the brief it waits for approval. Until then the proxies are: snapshot
request volume, `known_snapshot_built` counts, `wrong_conversion` feedback, and
`FALLBACK_PIPELINE_ERROR` reports.

`conversionFailures` cannot stand in for it: the failure reporter reads the engine's own
unmapped list, so a sequence a fallback filled is still reported as a failure, as before.

## 6. Privacy and trust review

| Surface | State |
|---|---|
| Logs: user input / converted documents | Not logged. `known_snapshot_built` carries counts and a validated encoding id. `FALLBACK_PIPELINE_ERROR` carries a fixed message and no samples. Rate-limit failure logs carry no key or IP (pinned in `sharedCounter.rolloutHealth.test.ts`). |
| Logs: AI-generated text | Fixed in `c9068f8` for unreadable 200 responses. **Residual, pending a decision:** a JSON-parse failure in `lib/ai/responseSchema.ts` logs the parser's error, whose V8 message quotes a short fragment of the model's text; validator rejection messages (logged in `debug`) may quote "the offending characters"; a provider's non-2xx body (provider-authored error JSON) is logged as-is. |
| Logs: secrets / tokens / keys | No key, token or credential is put in any log line by this code. The Gemini key travels in the request URL; a `fetch` failure's `cause` is logged, and undici's messages do not normally include the URL, but this has not been proven by a test. |
| `FALLBACK_ACCEPTED_LABEL` | **Approved (Phase 9).** `Accepted using AI-assisted fallback` / `AI-সহায়ক বিকল্প পদ্ধতিতে গ্রহণ করা হয়েছে`. Rendered from Stage 1. |
| `AI_UNVERIFIED_LABEL` | **Draft.** Currently `TBD — AI-suggested, unverified (wording pending review)`. Travels inside the public payload when `SERVE_UNVERIFIED_AI` is on; never rendered by the converter today. |
| Public known-pattern exposure | Unchanged and independent of both switches: per open pattern, the failed sequence, its category and its resolved flag (no counts, ids or timestamps); per servable resolution, sequence, candidate, verification, label, engine version. Threat model: `docs/threat-model-public-failure-endpoints.md`. |
| Unresolved output | Raw legacy bytes, monospace, danger colour; never guessed. |
| "This is wrong" | Opens the existing feedback form, prefilled with the sequence's code points and the substitution; the user submits it. It writes `feedback` only and cannot change a resolution. |
| AI text visible without human review | Only through the public API, only with `SERVE_UNVERIFIED_AI` on. Never in the converter with the current code. Always labelled. |
| Stored legacy input | `conversionFailures` holds context windows of at most 200 characters either side per occurrence. Rows written before the privacy bound may still hold `fullText` until `scripts/redactLegacyFailures.mjs` runs (pending-manual-steps §1.1). Nothing expires until the TTL policies are created. |

### Pending review — not decided here

1. ~~Final English and Bengali copy for `FALLBACK_ACCEPTED_LABEL`~~ — approved in Phase 9 (`release-record-phase9.md`).
2. Final copy for `AI_UNVERIFIED_LABEL` (blocks Stage 3).
3. Whether the residual log fragments above are acceptable, or the JSON-parse `cause` and the
   rejection messages should be reduced to codes. Each site is classified in
   `rollout-operations.md` §6; the schema-validation path was checked in Phase 8 and carries no
   model text.
4. Whether unverified candidates should ever render in the converter (needs code; see §2).

## 7. Scheduled re-verification (Vercel Cron) — decision record, not implemented

`docs/proposal-reverify-cron.md` was rechecked against the code and against current Vercel
documentation (2026-10-04). It still holds:

- The route is still `POST /api/admin/conversion-failures/reverify`, gated by
  `requireAdminUser` (Firebase ID token) and a per-admin shared rate limit keyed on the uid.
- Vercel Cron sends a **GET** to the production deployment with
  `Authorization: Bearer $CRON_SECRET` and no Firebase token
  (vercel.com/docs/cron-jobs/manage-cron-jobs). **The mismatch remains:** neither the method
  nor the credential matches, and there is no uid to key the rate limit on.
- Current Vercel behaviour the proposal relies on, re-confirmed: no retry on failure;
  best-effort delivery that can skip a run or deliver one twice (the sweep is idempotent);
  Hobby limited to once per day with ±59-minute precision; 100 cron jobs per project on every
  plan; `vercel.json` changes take effect on redeploy.

**What approval would cover:** (a) a second authentication exception, beside the admin
session cookie: one GET handler that accepts `Bearer $CRON_SECRET`, refusing when the
variable is unset; (b) a new `vercel.json` with one `crons` entry; (c) setting `CRON_SECRET`
in the Vercel project; (d) the schedule. None of it exists, and none is created by this work.
