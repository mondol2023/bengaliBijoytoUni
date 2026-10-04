# Fallback pipeline — canary stages and rollback

Status: **a plan. No stage has been entered.** Every stage change below is a Vercel project
change and needs the owner's explicit approval first. Facts about the switches, the signals
and the data are in [`rollout-readiness.md`](rollout-readiness.md); this file only orders
them.

## Constraints the plan is built around

- **There is no percentage or cohort mechanism in the code.** `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE`
  is one boolean, compiled into the bundle. A "controlled canary" therefore means a
  controlled *deployment*, not a slice of production traffic. Vercel's branch-scoped Preview
  environment variables give that without code.
- **Both switches need a deployment to change.** The pipeline switch needs a rebuild. The
  unverified switch needs a new deployment, because Vercel applies environment changes only
  to new deployments. Neither rollback is instantaneous; §Rollback gives the fastest path for
  each.
- **Propagation floor: about six minutes.** After a change reaches the server, a browser may
  keep a snapshot for `max-age=60` plus `stale-while-revalidate=300`, and an instance keeps a
  built snapshot for 60 s (`SNAPSHOT_TTL_MS`). This is the only duration the repository
  justifies. It is the minimum wait before judging a change, not an observation period.
  The repository holds no evidence for how long each stage should run, so the owner sets
  that.
- **Percentages and SLAs are not invented here.** Abort criteria are stated as events that
  can be observed, not thresholds.

## Stage 0 — dark (the presumed current state)

| | |
|---|---|
| Switches | pipeline **off**, unverified **off**, in Production and Preview |
| What users see | the pre-Phase-6 converter, byte-identical (`rolloutMatrix.test.ts`) |
| Entry | none; this is the default every template ships |
| Verify | no request to `/api/conversion-failures/known` from the production converter; the `known` payload has no `"verification":"unverified"` entry; any `known_snapshot_built` line shows `"serveUnverified":false` |
| Exit to Stage 1 | the entry criteria of Stage 1 |

## Stage 1 — controlled canary on a Preview deployment

| | |
|---|---|
| Switches | **Preview, one branch only:** pipeline **on**. Production unchanged (both off). Unverified **off** everywhere. |
| Audience | whoever is given that Preview URL (team, invited testers). Vercel's deployment protection for Preview can restrict it further; that is a project setting, not decided here. |
| Entry criteria | (1) `FALLBACK_ACCEPTED_LABEL` copy approved, because this is the first stage that shows it (pending-manual-steps §3); (2) at least one `accepted` resolution exists for an encoding the testers will use, or there is nothing to observe; (3) this repository's checks green on the deployed commit; (4) owner approval. |
| What to watch | `FALLBACK_PIPELINE_ERROR` rows in `errorLogs`; `known_snapshot_built` lines (`resolutionsAccepted`, `resolutionsUnverified`, `serveUnverified`); `wrong_conversion` feedback; rate-limit refusals on `route: api/conversion-failures/known`; `[DATABASE_ERROR] Shared rate-limit check failed` lines |
| Success | testers see accepted fallbacks marked and labelled; Copy and Download return the engine's text; no `FALLBACK_PIPELINE_ERROR`; every `known_snapshot_built` line has `resolutionsUnverified: 0` and `serveUnverified: false`; every `wrong_conversion` report on a filled segment has been triaged |
| Abort | any `FALLBACK_PIPELINE_ERROR`; any `resolutionsUnverified > 0` or `serveUnverified: true`; a filled segment an admin confirms is wrong (reject that resolution; see Rollback); a converter that fails to render for a tester |
| Rollback | remove the branch's Preview variable and redeploy that branch, or simply stop sharing the URL. Production is not involved. |

Shared-data note: a Preview deployment configured with the production Firebase credentials
reads the real snapshot (read-only) and its failure reporter writes real `conversionFailures`
rows, exactly as Production already does. If that is unwanted, give the Preview its own
Firebase project. That is a configuration decision for the owner.

## Stage 2 — Production

| | |
|---|---|
| Switches | Production: pipeline **on**, unverified **off** |
| Entry criteria | Stage 1 success, held for as long as the owner decided; owner approval |
| Change | set `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE=true` for Production, then trigger a **new production build** (a redeploy that rebuilds, not a promotion of an old build). Note the deployment id of the last flag-off production deployment first, because it is the fast rollback target. |
| What to watch | the Stage 1 signals, plus request volume for `/api/conversion-failures/known` (a lower bound on pipeline use), Firestore read volume, and `firestore_writes` lines (the pipeline adds reads, not writes; the "this is wrong" control adds `feedback` writes) |
| Success | the Stage 1 success conditions, on production traffic |
| Abort | the Stage 1 abort conditions; rate-limit refusals for legitimate readers on the `known` route (120 per 5 minutes per caller) |
| Rollback | §Rollback A |

## Stage 3 — optional, separate trust decision: `SERVE_UNVERIFIED_AI`

Not a rollout step. With the code as it is, turning this on **shows readers nothing new in
the converter**: browsers cannot read the flag, so `runConversion` refuses unverified entries.
Its only effect is to put unreviewed AI candidates, labelled, into a public JSON endpoint.
As things stand it adds exposure with no reader-facing benefit, so this plan does not
recommend it.

If the owner still wants it:

| | |
|---|---|
| Entry criteria | written owner approval of the trust decision; `AI_UNVERIFIED_LABEL` copy approved; a decision on whether unverified entries should ever render (which needs a code change, separately approved) |
| Change | `SERVE_UNVERIFIED_AI=true` for Production, then a new deployment |
| Watch | `known_snapshot_built` lines now carry `serveUnverified: true` and the count of unverified entries published |
| Abort | any unverified candidate an admin judges harmful or wrong; any report of unverified text being shown unlabelled |
| Rollback | §Rollback B |

## Rollback

### A. The fallback pipeline (`NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE`)

The value is compiled into the client bundle, so unsetting the variable changes nothing until
a new build is served.

1. **Fastest:** in Vercel, promote (Instant Rollback) the last production deployment that was
   **built with the pipeline off**, recorded at Stage 2 entry. This is only equivalent if
   nothing else that matters shipped in between; otherwise use step 2.
2. **Durable:** unset the variable for Production, then trigger a new production build.
   Without step 2, the next ordinary deployment would rebuild with the pipeline on again.
3. Already-open tabs keep the bundle they loaded until they reload. Expect stragglers.

What the rollback restores, pinned by `rolloutMatrix.test.ts` ("rollback"): no snapshot fetch,
`fallback: null`, and output markup byte-identical to the pre-Phase-6 converter.

### B. Unverified serving (`SERVE_UNVERIFIED_AI`)

Read per request on the server, but Vercel applies env changes only to new deployments.

1. Unset the variable for Production, then redeploy. A rebuild is not needed, but a new
   deployment is. Instant Rollback to a deployment created before the variable was set also
   works.
2. The next snapshot build after that excludes unverified entries. The per-instance cache is
   keyed on the switch, so an old build cannot mask the change (pinned in
   `known/route.test.ts` and `rolloutMatrix.test.ts`).
3. Browsers may hold the previous payload for up to about six minutes (`max-age=60`,
   `stale-while-revalidate=300`). No converter renders those entries either way (pinned in
   `rolloutMatrix.test.ts`).
4. Faster for a **single** bad candidate: an admin **rejects** that resolution in
   `/admin/conversion-failures/[patternId]`. A rejected resolution is never served, under
   either switch, from the next build on.

### What happens to stored data

| On rollback of… | Fallback / resolution records | Failure reports (`conversionFailures`, `failurePatterns`) | AI-generated resolutions (`aiResolutions`) | New writes |
|---|---|---|---|---|
| A. the pipeline | none exist: the pipeline writes nothing (`hitCount` counting is not wired) | untouched; the reporter never depended on the switch and keeps writing | untouched | stops: `feedback` from "this is wrong" (the control disappears) and `FALLBACK_PIPELINE_ERROR` reports. Failure reports continue as before. |
| B. unverified serving | — | untouched | **untouched**: the switch only changes what a snapshot build selects; nothing is deleted, relabelled or re-reviewed | none were caused by the switch |

Disabling either switch **changes no stored data**. Re-enabling restores exactly the prior
behaviour from the same data. Nothing in either rollback needs a Firestore migration.

## Approvals this plan needs, in order

1. Final copy for `FALLBACK_ACCEPTED_LABEL` (before Stage 1).
2. Setting the Preview variable for one branch (Stage 1).
3. Setting the Production variable and rebuilding (Stage 2).
4. Optional, separately: `AI_UNVERIFIED_LABEL` copy, the `SERVE_UNVERIFIED_AI` trust decision,
   and, if unverified text should ever render, the code change that would allow it (Stage 3).
5. Unrelated to the stages but open: TTL policies and indexes in the Firebase console, the
   legacy-row redaction script, a client → server beacon for per-conversion fallback counts
   (an API-contract change), and the reverify cron (`rollout-readiness.md` §7).
