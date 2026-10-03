# Proposal: run the reverify sweep on a Vercel Cron schedule

**Status: proposal only. Nothing here is implemented.** There is no
`vercel.json` in the repository, no cron route, and no `CRON_SECRET`
handling. Everything under "What it would take" is a sketch, written so it
can be approved or turned down as one decision.

## 1. The gap

`docs/phase-5-conversion-with-fallback.md` §3 named two triggers for deciding
whether a stored failure pattern is now resolved. Only one of them runs by
itself:

| Trigger | What fires it today |
|---|---|
| A new occurrence arrives (`f28fc32`, `1b82927`) | Automatic, on `POST /api/conversion-failures` |
| The engine or a rule table changes | **Nothing.** An admin has to call `POST /api/admin/conversion-failures/reverify` by hand |

The second trigger is the one that matters, because a table fix is how a gap
actually closes. Today a pattern the engine now converts stays `open` until
someone remembers to sweep, or until the same sequence is reported again,
which for a fixed sequence is exactly what stops happening.

The cost of that staleness is bounded, and it helps to say how far, so the
schedule is not oversold:

- **Users are not affected.** `runConversion` runs the engine first and
  consults the store only for what the engine still fails on (Phase 5 §1),
  so a stale `open` status never gets a wrong fallback to a user.
- **The admin queue is.** Already-fixed patterns stay in the "open" work
  list, and the "resolved" count understates.
- **The public snapshot is, slightly.** It publishes `open` patterns
  (`4c0f69a`), so a fixed pattern stays published until a sweep marks it
  resolved. Nothing renders that array today (threat model §2, residual).

## 2. Recommendation

**One daily Vercel Cron job, `0 21 * * *` (21:00 UTC), calling the sweep.**

## 3. Why daily: the evidence

**1. The verdict can only change when the deployed engine changes.**
`reverifyPattern` re-runs `convertLegacyText` over a sequence the server
already stored (`lib/conversionFailures/reverify.ts`). Same engine and same
input give the same answer, so between deployments every sweep after the
first is a guaranteed no-op. The rate that matters is therefore deployment
of engine changes, not traffic.

**2. Engine changes are rare.** From this repository's own history
(`git log -- features/converter/encodings features/converter/engine/version.ts`):

| Measure | Value |
|---|---|
| Repository span | 2026-09-13 → 2026-10-04 (22 days) |
| Commits touching the rule tables or the engine version | 5 |
| Distinct days with such a commit | 4 |
| `CONVERSION_ENGINE_VERSION` changes | 1 (`dc1f7e6`, 2026-09-20) |
| Most recent rule-table change | `8c52f44`, 2026-09-21 |

That is about one change-day a week during the most active development the
tables have had, and none in the last 13 days. Those are commits, not
deployments, so deployments can only be fewer. An hourly schedule would be a
no-op in more than 99% of runs. Daily bounds the staleness after a deploy to
under a day, which is the right order for a work queue that a human reads.

**3. Daily is the only interval every Vercel plan allows.** Per
https://vercel.com/docs/cron-jobs/usage-and-pricing, Hobby cron jobs run "once
per day" at most, and "expressions that would run more frequently will fail
during deployment", with "per-hour (±59 min)" precision. Pro and Enterprise
allow once per minute. The plan this project is on is not recorded in the
repository, so the proposal has to deploy on Hobby. A tighter interval would
need Pro and would buy nothing, per point 2.

**4. It is safe to miss or repeat.** Vercel calls cron delivery "best
effort", says a run can be skipped or invoked "more than once", and
recommends idempotent, reconciliation-based jobs
(https://vercel.com/docs/cron-jobs/manage-cron-jobs). The sweep already is
one. It writes only `status`, only where the stored value disagrees with the
engine, and never deletes (`lib/firebase/reverifyPatterns.ts`, pinned by
`reverifyPatterns.test.ts`). A duplicate run writes nothing, and a missed run
is caught by the next one.

**5. It is cheap.** One sweep reads at most `REVERIFY_SWEEP_LIMIT` (200)
pattern documents and writes only the statuses that change: zero on every
day after the first post-deploy sweep. Daily, that is at most about 6,000
reads a month, inside the free tier's 50,000 reads a day. The work is 200
pure conversions of strings of at most 200 characters, far inside any
function duration limit.

**6. Why 21:00 UTC.** This is 03:00 in Bangladesh (UTC+6), the converter's
main audience, so the sweep's reads land at the quietest hour. On Hobby
precision the run lands anywhere from 21:00 to 21:59 UTC. Nothing depends on
the exact minute, and it stays clear of the 00:00 UTC rollover of the AI
call budget (`lib/ai/costCap.ts`), which it does not touch anyway.

## 4. What a daily sweep does not cover

**The window is the 200 most recently seen patterns.** `reverifyStoredPatterns`
reads `listFailurePatterns({ limit: 200 })`, ordered by `lastSeenAt`
descending, and re-checks every pattern in that window, whatever version it
was stored under. A pattern outside the 200 most recently seen is never
swept by a bare call, scheduled or manual. How many patterns exist is not
known from here (no live-project reads, by instruction), so whether this
bites is unmeasured. If `failurePatterns` grows past 200, the fix is to
page through the collection with a cursor across runs, or to filter on
`engineVersion != CONVERSION_ENGINE_VERSION`. Either is a change to the
sweep, so it is listed here and not taken.

**A post-deploy trigger would be more exact.** Because the answer changes
only on a deploy, a deploy-time sweep would close the gap immediately rather
than within a day. Vercel Cron cannot express "after a deploy". Doing that
needs a deploy hook or a CI step with a credential, which is more machinery
than the staleness warrants. The daily job is the simple backstop and does
not rule it out later.

## 5. What it would take (not implemented)

The existing endpoint cannot be the cron target as it stands. Vercel Cron
sends a **GET** to the **production** deployment, authenticated only by
`Authorization: Bearer $CRON_SECRET`. `/api/admin/conversion-failures/reverify`
is a **POST** that calls `requireAdminUser`, which verifies a Firebase ID
token, and a cron job has no Firebase user.

So the change is a GET handler beside the existing POST that:

1. Compares the `Authorization` header to `Bearer ${process.env.CRON_SECRET}`
   in constant time (`crypto.timingSafeEqual`), and refuses with 401 when
   `CRON_SECRET` is unset. An unset secret must never mean "open".
2. Calls the same `reverifyStoredPatterns({})` the POST does. There is no
   body and no parameters, so a caller cannot choose a window or a verdict.
3. Writes the same audit entry, with `actorUid: "vercel-cron"`.
4. Takes no admin rate limit (there is no uid to key on). The secret is
   the gate, and the sweep is idempotent.

```json
// vercel.json — proposed, does not exist
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/admin/conversion-failures/reverify", "schedule": "0 21 * * *" }]
}
```

**This is a second authentication path on an admin route.** `CLAUDE.md`
says every API route authenticates with a Firebase bearer token, with
exactly one documented exception (the admin layout's session cookie). A
`CRON_SECRET` check would be a second exception: narrow (one route, one
action that takes no input), but an exception, and it needs explicit
approval for that reason as much as for the schedule. The alternative that
avoids it is a dedicated `/api/cron/reverify` route outside
`app/api/admin/`. That is cleaner to reason about, but it still needs the
same approval.

**Manual steps it would add:** set `CRON_SECRET` (at least 16 random
characters, per Vercel) in the Vercel project's production environment. It
must never be committed, logged or put in `.env.example` with a real value.
