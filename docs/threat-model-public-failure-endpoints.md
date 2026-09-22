# Threat model: the two public conversion-failure endpoints

Scope: `POST /api/conversion-failures` and `GET /api/conversion-failures/known`.
Both are reachable without authentication, by design — a conversion failure
happens before anyone signs in, and the known-patterns snapshot is meant to
be fetched on page load.

Everything below is read off the code as it stands on
`feat/font-conversion-hardening`. Where the answer depends on how the app is
deployed, that is said rather than assumed: **nothing in this repository
declares a hosting platform** — there is no `vercel.json`, and neither
`next.config.ts`, `package.json` nor `README.md` names one. The deployment
model is therefore an open question, and the findings are stated for both the
single-instance and the multi-instance case.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Body was buffered before any bound applied | Medium | **Fixed** — `lib/security/readJsonBody.ts`, 512 KiB ceiling |
| 2 | Counts can be poisoned to choose the published top N | **High**, latent | **Not fixed** — mitigation proposed, belongs with Phase 4 §5 |
| 3 | Rate limiter is per-instance and resets on cold start | Medium | Known and documented; not fixed here |
| 4 | Rate-limit identity collapses to one bucket without a proxy header | Low | Not fixed — needs a deployment answer first |
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

## 5. Caller-chosen snapshot size

`?limit=` is validated as an integer in `[1, 200]`
(`KNOWN_PATTERNS_MAX_LIMIT`), and the cache is keyed by `encodingId:limit`
with `maxEntries: 32`. A caller can vary `limit` to miss the cache
deliberately — 200 distinct values against a 32-entry cache — turning each
request into a Firestore query of up to 200 documents. Bounded by the 120/5min
limit, and by finding 3's caveats on that limit.

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
