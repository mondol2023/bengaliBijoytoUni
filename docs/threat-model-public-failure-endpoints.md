# Threat model: the two public conversion-failure endpoints

Scope: `POST /api/conversion-failures` and `GET /api/conversion-failures/known`.
Both are reachable without authentication, by design — a conversion failure
happens before anyone signs in, and the known-patterns snapshot is meant to
be fetched on page load.

Everything below is read off the code as it stands on
`feat/font-conversion-hardening`. Where the answer depends on how the app is
deployed, that is said rather than assumed. Until 2026-10-04 nothing in the
repository declared a hosting platform, so findings 3 and 4 were written for
both cases. **The maintainer has since answered: Vercel, serverless,
potentially multiple concurrent instances**, and the repository is to be
treated as a multi-instance deployment. Findings 3 and 4 are resolved on
that basis; see their sections.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Body was buffered before any bound applied | Medium | **Fixed** — `lib/security/readJsonBody.ts`, 512 KiB ceiling |
| 2 | Counts can be poisoned to choose the published top N | **High**, latent | **Closed** — `4c0f69a`, `f28fc32`; residual stated in §2 |
| 3 | Rate limiter is per-instance and resets on cold start | Medium | **Closed** — `8d956b9` (shared Firestore window counter); cost cap `e370f93` |
| 4 | Rate-limit identity collapses to one bucket without a proxy header | Low | **Closed** — `516493a` (Vercel headers), `8d956b9` (unknown bucket never shared) |
| 5 | Snapshot `limit` is caller-chosen up to 200 | Low | Accepted |

Finding 2 is marked *latent* because it is not currently exploitable against
users: nothing in the UI reads `/api/conversion-failures/known` yet. The only
importers of `lib/conversionFailures/knownPatternsClient.ts` are its own test
and `lib/cache/__tests__/privacy.test.ts`. Phase 4 §5 — extending the
snapshot and serving it in the product — is the change that makes it live,
which is why the mitigation is proposed there rather than bolted on now.

---

## 1. Payload size: were bodies capped? No. Now they are.

**Before.** `POST` called `await request.json()`, then validated with zod.
Every field bound in the schema (`maxFailedSequenceLength` 200,
`maxContextLength` 200, `maxErrorReasonLength` 500,
`maxFailuresPerReport` 50) is enforced *after* the entire body is buffered
into the process. A caller could stream an arbitrarily large body and have it
held in memory before the first bound was consulted. The bounds described the
accepted shape; they did not bound what the server would hold.

The `GET` takes no body, so this finding is specific to the `POST`.

**Fixed.** `lib/security/readJsonBody.ts` applies a 512 KiB ceiling twice:
`Content-Length` when present (rejects before a byte is read) and a running
byte count while streaming (catches a chunked request, and a header that
lies). Over the ceiling returns `LIMIT_EXCEEDED_ERROR` → **413**, and
`reader.cancel()` stops pulling rather than finishing the read and then
discarding it.

**Why 512 KiB.** The largest report the schema permits is 50 entries of about
2,100 code units each. A UTF-16 code unit costs at most 3 UTF-8 bytes — a
4-byte character occupies two code units, so the ratio cannot exceed 3 — which
puts the worst legitimate case near 320 KB including keys and punctuation.
`lib/security/__tests__/readJsonBody.test.ts` asserts that headroom against
the live constants, so raising a schema bound past the ceiling fails a test
rather than silently rejecting real reports.

Cheap and clearly safe: no legitimate client can reach it, it changes nothing
below the ceiling, and `route.test.ts` asserts both that an oversized body is
refused with 413 without reaching the writer, and that a maximal-but-valid
50-entry report still returns 200.

## 2. Count poisoning: yes, and it chooses what gets published

This is the real finding.

**The mechanism.** `POST` accepts anonymous reports. Each entry carries a
caller-supplied `occurrenceCount` (at most `maxOccurrenceCount`, 1000) and a
caller-supplied `failedSequence` (at most 200 characters, with no content
constraint beyond length). The writer increments
`failurePatterns.occurrenceCount` by that amount. `GET .../known` returns
patterns **ordered by `occurrenceCount`**, top N.

So the arithmetic, per source IP, per instance, per 5-minute window:
50 patterns x 1000 x 30 requests = **1.5 million claimed occurrences**. The
real corpus is a handful of genuine legacy sequences. Reaching the top of the
ranking is not an attack requiring scale; one window from one IP is enough.

**What that buys an attacker.**

- *Attacker-chosen text served to every user of an encoding.* The published
  projection is three fields, and `failedSequence` is one of them —
  200 characters the attacker wrote, delivered to anyone who loads the
  converter, cached for 60 seconds server-side and again at the client via
  `Cache-Control`. React escapes it, so this is content injection, not script
  injection: abusive text, a phishing string, a URL. Latent today because no
  UI reads the snapshot.
- *Displacement.* Genuine patterns fall out of the top N and stop being
  published at all, which is the quieter half of the same problem.
- *Misdirected work.* The admin "most frequent" ordering and, in Phase 4, the
  choice of which patterns are worth an AI call, both read this number.
  Poisoning it spends money and attention on fabricated sequences.

**What already limits it.** `maxOccurrenceCount` exists precisely because the
batching change let one report move an aggregate by more than one, and the
clamp is applied twice (schema and writer). Firestore rules deny all client
writes to both collections (`allow write: if false`), so the only path in is
this route. The published projection is an explicit three-field construction,
so no count, timestamp or occurrence id leaks alongside. None of that stops
the ranking being chosen.

**Proposed mitigations, in the order I would do them. None implemented here.**
*(Since then: 1 ✅ reached through stored status — `4c0f69a`, `f28fc32`, see "Phase 6: closed"
below. 2, 3 and 4 are not built.)*

1. **Re-verify before publishing.** Run the current engine over the stored
   `failedSequence` when building the snapshot and publish only sequences the
   engine actually fails on. Invented text that converts cleanly — or is not
   legacy bytes at all — never reaches a user. This is the strongest fix and
   it is already half-asked-for: Phase 5 requests server-side re-verification
   of stored failed sequences against the current engine. Cost is bounded by
   the existing 60-second snapshot cache rather than paid per request.
   **Do this before the snapshot reaches the UI.**
2. **Rank by breadth, not volume.** Keep a distinct-`sessionId` count (or a
   coarse distinct-reporter estimate) per pattern and order the published
   snapshot by that, leaving `occurrenceCount` for the admin view. A single
   caller inflating one pattern a million times moves one unit of breadth.
   This needs a new field and a decision about what counts as a distinct
   reporter, so it is a Phase 4 design question, not a patch.
3. **A floor on publication.** Publish only patterns seen across more than
   one session, or older than some minimum age. Cheap, and it makes a
   same-minute injection ineffective, but it delays genuine new patterns too
   — a product trade, not a pure win.
4. **Lower `maxOccurrenceCount`.** Reduces the blast radius per request by a
   constant factor and does not change the conclusion; 1000 is defensible
   against a real document, and the attacker simply sends more requests. Not
   worth the behaviour change on its own.

I did not implement 1 in this commit because it changes what the endpoint
serves, and the user-visible contract of that endpoint is Phase 4 item 5's
subject. Doing it here would pre-empt a decision that is explicitly on the
Phase 4 list.

**Phase 5 note (`1b82927`).** Server-side re-verification now exists, but
deliberately *not* on the snapshot build: the approved Phase 5 scope put the
engine re-run behind two triggers (an engine/rules change, and a new
occurrence) and ruled it out of the build path. So mitigation 1 above is
still not in place. What changed is that a stored `status` is now kept
honest; what did not is that `/api/conversion-failures/known` publishes
without filtering on it, and a poisoned pattern is `open` anyway, which is
the half of finding 2 that re-verification never addressed. Filtering the
published snapshot by stored status is the cheap next step and needs no
engine run — it is a change to what the endpoint serves, so it is proposed,
not taken. *(✅ Taken in `4c0f69a`, next paragraph.)*

**Phase 6: closed.** Two commits, and what each one is evidence for:

- **`4c0f69a`** — the snapshot builder filters by each pattern's *current*
  stored status, derived at read time
  (`lib/conversionFailures/publishable.ts`). Only an `open` pattern is
  published, and only a resolution whose provenance pattern is `open`. No
  new stored field: a pattern the sweep marks `resolved` drops out of the
  next build with no write beyond that status change, and a resolution
  whose pattern has expired fails closed. Pinned by
  `app/api/conversion-failures/known/route.test.ts` ("publication follows
  current status": present in one build, absent in the next, only the
  status changed, nothing written to the resolution).
- **`f28fc32`** — the status is honest from the first write. Before it, the
  occurrence-time re-verification ran only on the *update* path, so a single
  anonymous report at the 1000 ceiling created an `open` pattern even for
  text the engine converts cleanly, and with the filter above that is
  exactly what gets published. Creation now takes the same pure verdict.
  Pinned by `lib/firebase/__tests__/conversionFailures.test.ts`
  ("re-verifies on creation…").

Together that is mitigation 1's guarantee, reached through stored status
rather than an engine run per build: **the snapshot publishes only
sequences the current engine fails on**, as of the last write to that
pattern or the last sweep. Invented text that converts cleanly never
reaches it.

**Residual, stated so it is not mistaken for closed:**

- *Text containing at least one unmapped byte* still fails honestly, is
  `open`, and can still be ranked into `patterns` by count. Mitigation 2
  (rank by breadth) is what would address that, and it is not built. It is
  not reachable by a user today: nothing renders the public `patterns`
  array — the converter's only consumer of the snapshot,
  `features/converter/resolutionSource.ts` → `resolutionMapFrom`, reads
  `resolutions` alone, and a resolution reaches that array only after an
  admin accepted it. If a UI ever renders `patterns`, reopen this.
- *Propagation delay.* A status change reaches a reader after the
  per-instance snapshot cache (60 s), the response's `max-age=60`, and the
  client's 10-minute `localStorage` freshness. Nothing is applied from a
  stale copy that the engine now converts, though: `runConversion` runs the
  engine first and consults the store only for what it still fails on.

## 3. Does the rate limiter work in this deployment model?

**Honestly: unknown, and weaker than it looks in the likely case.**

`lib/security/rateLimit.ts` is a fixed-window counter in a module-level `Map`.
Its own header says so, and `README.md` line 188 already discloses it. The
consequences, stated against these two routes:

- **Multi-instance (any serverless host).** Each instance holds its own map,
  so the effective ceiling is `limit x instance count`. For the `POST` that is
  30 x N per 5 minutes, and N is chosen by the platform's autoscaler — which
  is to say, partly by the attacker, since load is what scales it. Combined
  with finding 2 this is the multiplier that matters: 1.5M claimed
  occurrences per window becomes 1.5M x N.
- **Cold starts.** Every counter resets. A caller who paces requests to land
  on fresh instances is not rate-limited at all.
- **Single instance.** It works as written, and is adequate for blunting
  casual scripted abuse — which is what it was built for.

There is no cheap fix. A correct limiter needs shared state — Redis, or a
Firestore transaction counter — and a Firestore counter on a route whose whole
purpose is to bound Firestore writes needs its own cost analysis first. What
*is* cheap is not pretending: the limiter is a speed bump, the clamps and the
new size ceiling are the real bounds, and finding 2's mitigation 1 is the one
that does not depend on the limiter working at all.

**Open question for you:** what is this deployed on, and is it one instance or
many? The answer decides whether finding 3 is documentation or work.

**Asked of the repository, Phase 5 (`6b548d9`): it does not know.** No
`vercel.json`, `Dockerfile`, `Procfile`, `fly.toml`, `render.yaml` or
`app.yaml` is tracked; `next.config.ts` sets no `output`; `package.json`
starts the app with a plain `next start`; and the only CI workflow
(`.github/workflows/playwright.yml`) runs tests and has no deploy job. The
sole "vercel" match in the tree is `public/vercel.svg`, a create-next-app
leftover. So this stays a question for the maintainer, not one the code can
answer — and the shared-counter migration it would require was deliberately
not built on a guess.

**Resolved, 2026-10-04: Vercel, multi-instance.** The answer made finding 3
work rather than documentation, and the work is done.

- **`8d956b9`** — every rate-limited route (nine of them) now calls
  `checkSharedRateLimit` (`lib/security/sharedRateLimit.ts`). The existing
  in-memory limiter runs first; a request it admits is then checked against
  one Firestore document per caller per aligned window
  (`rateLimitWindows/{sha256(key)}_{windowStart}`), reserved in a
  transaction through `lib/firebase/sharedCounter.ts`. The ceiling is now
  `limit` per caller per window for the deployment, whatever the instance
  count, and a cold start resets nothing that matters. Combined with finding
  2, one IP's 1.5M claimed occurrences per window is now 1.5M, not 1.5M x N.
- **`e370f93`** — the AI daily call budget (`lib/ai/costCap.ts`) moved to
  the same store, one document per UTC day, because it had exactly the same
  per-instance defect. Unlike the limiter it fails closed.

**When the shared layer cannot answer**, the limiter keeps the per-instance
verdict and logs (`DATABASE_ERROR` from `lib/security/sharedRateLimit`).
That is the pre-fix bound, not no bound, and it keeps a Firestore outage from
taking down document extraction, which never needed Firestore. Firebase not
being configured at all takes the same path.

**The cost analysis this section said was needed first.** A Firestore
counter on a route whose purpose is to bound Firestore writes has to pay for
itself, so here is the arithmetic:

| Request | Before | After |
|---|---|---|
| Refused by the instance's own window | 0 | 0 — the local layer runs first |
| Refused by the shared window | (was admitted on another instance) | 1 read, **0 writes** — a refusal writes nothing |
| Admitted, `POST /api/conversion-failures` | 2 writes | 3 writes, +1 read |
| Admitted, any other limited route | its own writes, if any | +1 read, +1 write |

- *The attack case gets cheaper.* Per anonymous IP per 5-minute window on
  the report route the most that can be written is now 30 x 3 = 90
  documents, deployment-wide. Before it was 30 x 2 x N, with N set by the
  autoscaler and, through load, partly by the attacker. Beyond that, a flood
  costs one read per request, and only for requests that got past a local
  window first.
- *The honest case gets dearer.* An accepted report costs 3 writes instead
  of 2, so the free tier's 20,000 writes a day covers about 6,600 accepted
  reports instead of 10,000, if nothing else wrote. `GET .../known` pays one
  write per uncached fetch. That fetch was read-only before, but a browser
  revalidates at most once per 10 minutes, and a cache-missing request can
  read up to 200 documents (finding 5), which the counter now bounds
  deployment-wide.
- *Hot-document contention is not a risk at these limits.* Admission is the
  only thing that writes, so one window document takes at most `limit`
  writes per window: 30 per 5 minutes on the report route, and 100 a day on
  the AI budget. That is orders of magnitude under Firestore's
  sustained-write guidance for a single document.
- *Counted, not guessed.* Counter writes go through
  `lib/firebase/writeMetrics.ts`'s `countWrites`, so the per-minute
  `firestore_writes` log lines in `docs/write-volume.md` report them under
  `rateLimitWindows` and `aiCallBudget`. Whether the +50% on the report
  route matters can be measured instead of argued.

**Storage.** One window document per caller per window accumulates until
a Firestore TTL policy on `expireAt` deletes it. That policy is
console-only, so it is listed in `docs/pending-manual-steps.md`. Until it
exists the documents are small and inert, but they are not cleaned up.

**What stays per-instance on purpose:** the unknown-IP bucket (finding 4),
and every limit when Firebase is not configured.

## 4. Rate-limit identity

`getRequestIp` reads `x-forwarded-for`, then `x-real-ip`, then returns the
constant `"unknown"`. Two consequences:

- Behind a proxy that sets neither header, **every anonymous caller shares one
  bucket** — 30 requests per 5 minutes for the entire internet, which denies
  the route to real users rather than to an attacker.
- `x-forwarded-for` is trustworthy only when a proxy sets it and strips any
  client-supplied value. If the app is ever reachable directly, the header is
  attacker-controlled, and rotating it defeats the limiter per-instance too.

Both are properties of the deployment, not of the code, which is why nothing
is changed here. The function's doc comment already states the assumption.
The check to run once the platform is known: confirm which header the proxy
sets, and confirm it overwrites rather than appends.

**Resolved, 2026-10-04: Vercel.** Both consequences are closed.

- **Header trust, `516493a`.** Vercel's documented request headers
  (https://vercel.com/docs/headers/request-headers) answer the check this
  section asked for. Vercel *overwrites* `x-forwarded-for` ("we currently
  overwrite the X-Forwarded-For header and do not forward external IPs.
  This restriction is in place to prevent IP spoofing"). It also sets
  `x-vercel-forwarded-for` to the same address, which survives a proxy
  placed in front of Vercel. `getRequestIp` now prefers
  `x-vercel-forwarded-for` when `VERCEL=1`, and only then, since off Vercel
  a client could forge it. It falls back to `x-forwarded-for`, which on
  Vercel is overwritten and therefore not client-controlled. If the
  project's "system environment variables" setting is off, `VERCEL` is
  unset and the `x-forwarded-for` path still gives the right answer.
- **The one-bucket collapse, `8d956b9`.** On Vercel a client-IP header is
  always present, so `"unknown"` is a local-dev and misconfiguration path.
  It still had to be handled, because finding 3's fix would otherwise have
  made it worse: a *shared* unknown bucket is one window for every
  unidentified caller on every instance. `rateLimitIdentity` marks it
  `shared: false`, so it keeps the old per-instance behaviour and never
  reaches Firestore.

Residual: if a proxy is ever put in front of Vercel, confirm that it does
not strip `x-vercel-forwarded-for`. If it does, every request reads the
proxy's address and all callers share that proxy's window. That is a
deployment change, not a code one.

## 5. Caller-chosen snapshot size

`?limit=` is validated as an integer in `[1, 200]`
(`KNOWN_PATTERNS_MAX_LIMIT`), and the cache is keyed by `encodingId:limit`
with `maxEntries: 32`. A caller can vary `limit` to miss the cache
deliberately — 200 distinct values against a 32-entry cache — turning each
request into a Firestore query of up to 200 documents. Bounded by the 120/5min
limit, which since finding 3's fix (`8d956b9`) holds per caller across the
whole deployment rather than per instance.

Accepted rather than fixed. The read is cheap, the ceiling is low, and the
obvious hardening (snapping `limit` to a few allowed values) trades a real API
affordance for a small cost saving. Worth revisiting only if Firestore read
volume becomes visible the way write volume did in `docs/write-volume.md`.

## What is not a finding

- **No data leaks through the projection.** `toKnownPattern` names three
  fields explicitly and `lib/conversionFailures/__tests__/knownPatterns.test.ts`
  asserts the result has exactly those keys, so growing `FailurePattern`
  cannot widen the public payload. Counts, timestamps and
  `sampleOccurrenceIds` stay server-side.
- **`userId` is never taken from the body.** Both routes read it from the
  verified token or leave it null.
- **Direct writes are closed.** `firestore.rules` denies all client writes to
  `conversionFailures` and `failurePatterns`; the route is the only way in.
- **The ETag does not leak.** `computeEtag` hashes only what is already in the
  response body, and excludes `generatedAt` deliberately.
