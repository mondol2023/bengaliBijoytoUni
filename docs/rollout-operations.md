# Fallback pipeline — operations runbook and approval matrix

Status: **nothing enabled, nothing deployed.** Both rollout switches are off in every template
this repository ships. No Vercel or Firebase setting was changed to write this. Written
2026-10-04 for the "Phase 8 — Controlled Rollout Hardening" brief, on top of `540f2f4`.

Read with: [`rollout-readiness.md`](rollout-readiness.md) (what the switches do, where
data lives) and [`rollout-canary-and-rollback.md`](rollout-canary-and-rollback.md) (the
stages and how to undo each). This file adds what an engineer needs to *run* those stages
without guessing: what is decided and what is not, how long to wait, what to check, and
what cannot be observed yet.

## 1. Status, by kind

### Implemented and tested

| What | Evidence |
|---|---|
| Default-deny parsing of both flags: trimmed, any case, only `1` `true` `yes` `on` | `serveFlags.test.ts`, including accidental values (`"true"` with quotes, zero-width and full-width spellings) |
| `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` is build-time in the browser, read by its literal name | `serveFlags.test.ts` (source spelling); `checkClientFlags.script.test.ts` (built bundle) |
| `SERVE_UNVERIFIED_AI` is off in every browser: not `NEXT_PUBLIC_`, read by a computed key, not forwarded by `next.config.ts`, no `NEXT_PUBLIC_` twin | `serveFlags.test.ts` "can never reach a browser bundle"; `npm run check:client-flags` on a build |
| Both flags empty or absent in every shipped `.env*.example` | `serveFlags.test.ts` |
| All four flag combinations, on the real route, client functions and output component | `rolloutMatrix.test.ts` (228 cases) |
| Rollback restores the pre-Phase-6 converter; unverified rollback is not masked by any cache | `rolloutMatrix.test.ts` "rollback" |
| The durations the propagation window is computed from | `propagation.test.ts` |
| A throwing pipeline degrades to the engine's output and reports `FALLBACK_PIPELINE_ERROR` | `164c9f9`, `fallbackPipeline` tests |
| Shared counters fail closed (budget) or degrade to per-instance (rate limit), without logging keys or IPs | `sharedCounter.rolloutHealth.test.ts` |
| One `known_snapshot_built` line per snapshot build | `snapshotLog.test.ts` |
| Provider privacy: unreadable 200 bodies are not logged; schema failures log no model text | `c9068f8`; `responseSchema.test.ts` |
| A post-build check that reads both flags back out of `.next/static` | `scripts/checkClientFlags.mjs` |

### Ready, not activated

| What | Blocked on |
|---|---|
| Stage 1, the pipeline on one Preview branch | a staging Firebase project; Vercel access; owner go (label copy, duration and abort criteria approved, `release-record-phase9.md`) |
| Stage 2, the pipeline in Production | Stage 1 passing; owner approval; owner-set canary duration |

### Needs a human decision

| Decision | Why it is not an engineering call |
|---|---|
| `SERVE_UNVERIFIED_AI` on, anywhere | Publishes unreviewed AI text on a public URL. Trust decision. |
| `AI_UNVERIFIED_LABEL` final copy | Product copy; only meaningful after the decision above. |
| Rendering unverified text in the converter | Needs a code change *and* a trust decision; today it cannot happen under any flag value. |
| Log-fragment policy (§6) | Privacy versus debuggability. |
| Per-conversion metrics endpoint | API-contract change (§5). |
| Reverify cron | A second authentication exception (`docs/proposal-reverify-cron.md`). |

### Needs infrastructure action (console or CLI, by the owner)

All listed in `docs/pending-manual-steps.md`, with exact steps there; none performed:

1. `node scripts/redactLegacyFailures.mjs` against production (§1.1), then
   `node scripts/backfillRetention.mjs` (§1.2).
2. TTL policies on `expireAt` for `conversionFailures`, `failurePatterns` (§1.3),
   `aiCallBudget`, `rateLimitWindows` (§1.4). Until they exist nothing expires.
3. `firebase deploy --only firestore:indexes` (§2). Until then the admin queries that need a
   composite index fail at runtime.
4. Vercel: the Preview and Production environment variables for each stage
   (`rollout-canary-and-rollback.md`), and, only if the cron is approved, `CRON_SECRET`.

### Out of scope for Phase 8

Wiring `hitCount` (`resolutionHits.ts` exists, unwired); any percentage or cohort rollout
mechanism (there is none: one boolean per build); the reverify cron; the metrics endpoint;
changing what any log line contains (§6); moving the Gemini key from the URL to a header (§6).

## 2. Approval matrix

| Decision / action | Repository ready? | Approval required? | Executed in Phase 8? |
|---|---:|---:|---:|
| Flag parsing (both flags) | Yes | No | Verified; tests added |
| `SERVE_UNVERIFIED_AI` kept out of browser bundles | Yes | No | Verified; tests and build check added |
| Post-build bundle check | Yes | No | Added |
| Preview pipeline rollout (Stage 1) | Yes; needs a staging Firebase project | **Yes** | No |
| Production pipeline rollout (Stage 2) | Yes | **Yes** | No |
| `FALLBACK_ACCEPTED_LABEL` final copy | Yes (approved Phase 9, pinned in `knownResolutions.test.ts`) | Given | n/a |
| `SERVE_UNVERIFIED_AI` on (Stage 3) | No | **Yes** | No |
| `AI_UNVERIFIED_LABEL` final copy | No (draft `TBD`) | **Yes** | No |
| Render unverified text in the converter | No (needs code) | **Yes** | No |
| Per-conversion metrics API | Design only (§5) | **Yes** | No |
| Firebase TTL policies / indexes | Operational; config in repo | **Yes** | No |
| Legacy-row redaction | Operational; script in repo | **Yes** | No |
| Reverify cron | Design in `proposal-reverify-cron.md` | **Yes** | No |
| Log-fragment policy | Decision pending (§6) | **Yes** | No |
| Gemini key out of the request URL | Small code change, untested against the live API | **Yes** | No |

## 3. Timing: three different durations

Phase 7 gave "about six minutes" as the propagation floor. That figure is right for what it
measured, the HTTP headers, but the browser also holds its own copy. The full chain, every
number pinned by `propagation.test.ts`:

| Layer | Duration | Applies to |
|---|---|---|
| Route's per-instance snapshot cache | 60 s | changes to stored data (an admin accepts or rejects) on a running deployment. A new deployment starts empty. |
| HTTP `Cache-Control: public, max-age=60, stale-while-revalidate=300` | up to 6 min | a browser with no usable localStorage copy |
| Browser localStorage copy (`KNOWN_PATTERNS_FRESH_MS`) | 10 min with no request at all | every browser with the pipeline on |
| Same copy kept as the answer to a failed revalidation (`KNOWN_PATTERNS_RETAIN_MS`) | up to 60 min | when revalidation errors, is rate-limited, or returns an invalid payload |
| An open tab | until reload or encoding change | the snapshot is fetched once per encoding; the bundle once per load |

The HTTP and localStorage windows do not add up: a revalidation happens only once the
10-minute copy is stale, by which point the 6-minute HTTP entry has expired too.

Whether Vercel's CDN also caches this response has **not been verified** from the repository.
Check it with `curl -sI` and the `x-vercel-cache` header on the deployed URL before relying on
the figures below.

**1. Technically observed propagation floor.** What the code guarantees:

| Change | Server stops serving the old answer | A reader who reloads stops seeing it |
|---|---|---|
| Pipeline on/off (new build) | n/a, browser-side | immediately on the new deployment; open tabs keep the old bundle until reload |
| `SERVE_UNVERIFIED_AI` off (redeploy) | immediately on the new deployment | nothing to stop seeing: the converter never renders unverified entries |
| Admin rejects one accepted resolution | ≤ 60 s | ≤ about 11 min (60 s + 10 min); ≤ about 61 min if revalidation fails; open tabs until reload |

Anything already fetched from the public endpoint, by a browser or anyone else, cannot be
recalled. Publication is not reversible, which is the main argument for keeping Stage 3 blocked.

**2. Minimum verification wait.** Before judging a stage: server-side checks (§4) at least
60 s after a data change, or immediately after a deployment; reader-side checks in a fresh
browser profile, or after clearing site data, so a localStorage copy cannot answer instead of
the server.

**3. Canary duration.** A business decision for the owner. Nothing in the repository says
how much traffic or time makes Stage 1 or Stage 2 conclusive, so no number is proposed.

## 4. Stage checks an engineer can run

`<host>` is the deployment under test. Each check names its signal and the pass condition.
"Any" means the owner has not set a tolerance, so the default is zero. Treat that as an
**operational decision to confirm**, not a measured threshold.

### Before any stage (local, at the commit to be deployed)

| Check | Command | Pass |
|---|---|---|
| Repository green | `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` | all exit 0 |
| Bundle as intended, flag unset | `npm run check:client-flags -- --expect-pipeline off` | exit 0 |
| Bundle as intended, flag on (rehearsal) | `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE=true npm run build && npm run check:client-flags -- --expect-pipeline on` | exit 0; `SERVE_UNVERIFIED_AI: OFF in every browser` |
| Rollback rehearsal | unset the variable, `npm run build`, `npm run check:client-flags -- --expect-pipeline off` | exit 0 |

The rehearsal builds are local and change no environment. Rebuild with the variable unset
afterwards, so the local `.next` is not left in the flag-on state. `next build` also reads
`.env.local` and `.env.production*`, so "unset" means unset there too. The checker reports
what was actually compiled, whichever file it came from.

### On the deployment (every stage)

| Area | Signal | Pass | Abort |
|---|---|---|---|
| Application health | `curl -s -o /dev/null -w '%{http_code}' https://<host>/converter` | `200` | not `200` |
| Pipeline state | Network panel on `/converter` with Bijoy text, fresh profile | a request to `/api/conversion-failures/known` exactly when the stage says the pipeline is on | the opposite |
| Unverified exposure (API) | `curl -s 'https://<host>/api/conversion-failures/known?encodingId=bijoy' \| jq '[.resolutions[] \| select(.verification=="unverified")] \| length'` | `0` | anything else |
| Unverified exposure (logs) | runtime logs, filter `known_snapshot_built` | every line has `"serveUnverified":false` and `"resolutionsUnverified":0` | any line that does not |
| Fallback pipeline exceptions | `/admin/errors`, code `FALLBACK_PIPELINE_ERROR` | none | any |
| Snapshot generation | `known_snapshot_built` lines appear after converter use | at least one per encoding used | none while `/known` returns 200 (the build path is not running) |
| Snapshot errors | runtime logs, `route: api/conversion-failures/known` with `[DATABASE_ERROR]` or `[UNKNOWN_ERROR]` | none | any sustained |
| Rate limiting | runtime logs, `[RATE_LIMIT_ERROR]` with `route: api/conversion-failures/known` | none from ordinary use (limit 120 per caller per 5 min) | refusals reported by legitimate readers |
| Shared-counter failures | runtime logs, `[DATABASE_ERROR] Shared rate-limit check failed` | none | sustained; limits are then per instance only |
| AI budget exhausted / unavailable | `[RATE_LIMIT_ERROR] This deployment's daily limit…` / `[UNKNOWN_ERROR] The AI call budget could not be checked…` on the resolve route | informational: the pipeline does not call providers | n/a for the stages; see `AI_DAILY_CALL_BUDGET` |
| Provider failures | resolve-route log lines (`"gemini" is unavailable right now.` and similar) | informational: admin-only path, unaffected by either switch | n/a for the stages |
| Known-failure reporting | `POST /api/conversion-failures` responses, `/admin/conversion-failures` | new patterns still arrive, as before the stage | reports stop arriving |
| Incorrect conversions | `/admin/feedback`, category `wrong_conversion` | every report on a filled segment triaged | an admin confirms a filled segment is wrong: reject it, then see §3 for timing |
| Privacy | `/admin/errors` rows for `FALLBACK_PIPELINE_ERROR`; runtime logs for the converter routes | `samples` empty; no user text in any line | any user text in a log line |
| Rollback | the Rollback A rehearsal above, plus the Instant Rollback target noted at Stage 2 entry | rehearsed before Stage 2 | n/a |

## 5. Observability: what cannot be seen yet

| Missing signal | Why it matters | Today's proxy |
|---|---|---|
| Per-conversion counts of `fallback_accepted`, `fallback_unverified`, `unresolved` | The only direct measure of what readers are shown. Stage 2 cannot say "N% of conversions used a fallback". | `/known` request volume (a lower bound, because of caching), `known_snapshot_built` counts, `wrong_conversion` feedback |
| How often each resolution is used | Ranks review work | none: `hitCount` is unwired |
| Scheduled reverify runs | Stale resolutions keep being served until an admin runs the sweep | `auditLogs` entries `conversion_failure_reverify` for manual runs |
| Whether Vercel's CDN caches `/known` | Changes the timing in §3 | `x-vercel-cache` response header, checked by hand |

### Design for the per-conversion counts (not implemented; needs approval)

- **Shape.** `POST /api/conversion-metrics`, anonymous, rate-limited like
  `/api/conversion-failures`. Body:
  `{ encodingId, engineVersion, rulesHash, conversions, segments: { fallback_accepted, fallback_unverified, unresolved } }`,
  integers only, summed in the browser and sent through the existing 2-minute localStorage
  outbox, so it adds no request per conversion.
- **Privacy.** Counts only. No sequences, no text, no visitor id, no user id. The disclosure
  copy would need one sentence; that copy is itself pending review.
- **Storage.** Preferred: none. The route validates and emits one stdout line
  (`{"metric":"fallback_segments",…}`, the `writeMetrics.ts` convention), and the log drain
  aggregates. Alternative: a daily `fallbackMetrics/{day}_{encodingId}` counter via
  `sharedCounter.ts` with a 35-day `expireAt`. That is one more TTL policy, and the document
  becomes a write hotspot (Firestore sustains about one write per second per document), so it
  would need sharding at volume.
- **Contract.** A new public endpoint and a new outbox message type. That is why it waits.

## 6. Log review: classification

Every log site on the paths the brief named, checked against the code at `540f2f4`. "Debug" means
`AppError.debug`, which `logAppError` prints in full to runtime logs and never sends to a
client.

| Site | What it logs | Classification |
|---|---|---|
| `known_snapshot_built` (`snapshotLog.ts`) | counts, validated encoding id, engine version, flag | Safe |
| `firestore_writes` (`writeMetrics.ts`) | counts per collection | Safe |
| `FALLBACK_PIPELINE_ERROR` (`fallbackPipeline.ts`) | fixed message, encoding id, `samples: []` | Safe |
| Shared rate-limit failure (`sharedRateLimit.ts`) | fixed message, Firestore cause; no key, no IP | Safe (pinned) |
| Budget exhausted / unavailable (`costCap.ts`) | limit, UTC day; Firestore cause | Safe |
| Failure ingest, error-log, anonymous-label writes | fixed message, Firestore or zod cause; zod 4 issues carry no input | Safe |
| Gemini / OpenAI: unreadable 200 body | top-level keys and enum reasons only | Safe (fixed in `c9068f8`) |
| Provider schema-validation failure (`responseSchema.ts`) | zod issues: paths, codes, limits | Safe (pinned in Phase 8) |
| Document-extract history failure | Firestore cause **and the user's uid** | Potentially sensitive (pseudonymous id); pre-existing, outside the pipeline |
| Provider fetch failure, both adapters | the thrown `cause` | Potentially sensitive: the Gemini key is in the request URL. undici's messages do not normally include the URL; unproven. Moving the key to the `x-goog-api-key` header would remove the question entirely, but that changes the provider call and cannot be checked here without a live key. **Needs a decision.** |
| **1. JSON-parse failure** (`responseSchema.ts`) | V8 `SyntaxError`, which quotes about ten characters of the model's text | **Needs a product/security decision.** Model output about one failed sequence, not user text; admin-triggered only. Useful for debugging prompt drift. |
| **2. Validator rejection** (`resolveConversionFailure.ts` → debug `rejections`) | the offending characters (`residual_legacy`, `unexplained_character`); for `dropped_passthrough`, the failed sequence's passthrough characters and those same characters as found in the candidate | **Needs a decision.** Low sensitivity: single characters of one legacy sequence and of model output, never user text. The same text is stored in `aiResolutions.reasoningSummary`, which is admin-only. |
| **3. Provider non-2xx body** (both adapters) | the provider's error body, as returned | **Needs a decision.** Provider-authored. Gemini and OpenAI error bodies do not normally echo the prompt or the key, but nothing bounds them. |

None of the three numbered items is a clearly unsafe leak of user data or a secret: each is
model or provider text about a single legacy sequence, on an admin-only path. So none was
changed. The options for each are: keep as is; reduce to a code plus length; or keep, but
truncate to a fixed bound.

## 7. Security boundary: findings

Checked for any path by which unverified AI text could reach a reader other than the one
Phase 7 documented:

- **Firestore.** `aiResolutions` is `allow read: if isAdmin()` in `firestore.rules`. No client
  reads it directly.
- **API.** `/api/conversion-failures/known` is the only route that serves resolutions without
  admin authentication. The admin routes require `requireAdminUser`.
- **Browser.** The converter refuses unverified entries because `SERVE_UNVERIFIED_AI` is a
  runtime read of an empty `process.env` in every browser. Phase 8 confirmed this in three real
  builds and pinned every way it could change (§1).
- **Payload.** An unverified entry always carries `AI_UNVERIFIED_LABEL` in the payload itself.

**No security blocker found.** The public exposure with `SERVE_UNVERIFIED_AI` on is the
documented, intended behaviour of that flag, and so a pending trust decision rather than a
vulnerability. It is the reason Stage 3 stays blocked.
