# Release record — Phase 9, Stage 1 Preview canary

Status: **Stage 1 not started.** All four owner decisions are recorded below. Two blockers
remain: there is no staging Firebase project (decision B), and this checkout has no Vercel access.

## Baseline (captured 2026-10-04)

| | |
|---|---|
| Branch | `feat/font-conversion-hardening` |
| HEAD at pre-flight | `80a0cc6` (Phase 8), working tree clean, no untracked files |
| Local flag state | neither `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` nor `SERVE_UNVERIFIED_AI` set in `.env.local` or the shell |
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass |
| `npm run test` | 1,762 passed, 102 files |
| `npm run build`, both flags unset | pass |
| `npm run check:client-flags -- --expect-pipeline off` | pass: 41 chunks, pipeline OFF, `SERVE_UNVERIFIED_AI` absent from every browser chunk |
| Vercel | no `.vercel` link in this checkout; no Vercel setting changed |
| Firebase | no Firebase setting changed |

## Owner decisions

### A. `FALLBACK_ACCEPTED_LABEL`: approved

| | |
|---|---|
| English | `Accepted using AI-assisted fallback` |
| Bengali | `AI-সহায়ক বিকল্প পদ্ধতিতে গ্রহণ করা হয়েছে` |

This is the owner's preferred pair. The shorter alternative (`Accepted with AI assistance` /
`AI সহায়তায় গ্রহণ করা হয়েছে`) is for use only if the UI needs it. The converter's tooltip
and summary line have room for the full pair, so the alternative is not used.

Accuracy check: every `candidateConversion` comes from the AI resolver
(`lib/ai/resolveConversionFailure.ts`). The admin review route only accepts or rejects a
candidate and cannot edit its text. So every `accepted` resolution really is AI-assisted.

Where it is used: `lib/conversionFailures/knownResolutions.ts` (the constant) and
`components/converter/ConversionOutputText.tsx` (tooltip and summary line). The exact strings
are pinned in `lib/conversionFailures/__tests__/knownResolutions.test.ts`.
`components/converter/__tests__/conversionOutput.test.ts` checks how the label renders.

### B. Firebase project for Preview: a separate staging project; none exists yet

Owner decision: Stage 1 must use a separate staging/Preview Firebase project. It must **not**
fall back to Production Firebase for convenience.

Finding: no staging project exists. `.env.local` points both SDKs at `legacy2uni`, the
production project. `docs/dev-environment.md` §7 lists a staging project as deferred.
**Stage 1 is blocked on this.**

Staging must provide, before Stage 1:

1. A new Firebase project (owner's Google account; not something this repository can create).
2. `firebase deploy --only firestore:rules,firestore:indexes,storage --project <staging-id>`.
3. The TTL policies from `pending-manual-steps.md` §1, so the canary exercises retention as
   Production will.
4. A service account for the Admin SDK on that project.
5. At least one `accepted` resolution for an encoding the testers will use (entry criterion 2
   in `rollout-canary-and-rollback.md`). Without one there is nothing to observe.
6. In Vercel, scoped to the canary's **Preview branch only**: every `NEXT_PUBLIC_FIREBASE_*`
   and `FIREBASE_ADMIN_*` variable set to the staging values. The `NEXT_PUBLIC_FIREBASE_*`
   values are inlined at build time, just like the pipeline flag.

### C. Canary duration: 60 minutes minimum, 90 preferred

Owner decision: **60 minutes minimum; 90 minutes preferred** if the Preview receives enough
realistic traffic. 60 covers the roughly 60-minute browser stale-retention window from Phase 8
(`rollout-operations.md` §3). Smoke tests and hard-failure monitoring start **immediately**
after deploy. The duration is a minimum observation window, not a wait before looking.

### D. Abort criteria: hard failures only, no numeric threshold

Owner decision: **no numeric error-rate threshold was authorized** for this canary. Abort
immediately if:

1. unverified AI text becomes visible;
2. `SERVE_UNVERIFIED_AI` becomes active;
3. a secret/API key, or user or model content, leaks into logs;
4. the normal conversion path regresses;
5. the application crashes;
6. fallback failures cause incorrect or missing normal output;
7. Firestore shared counters, rate limiting or budget enforcement fail materially;
8. the deployed bundle does not match the approved flag state;
9. the wrong Firebase project is being used;
10. the deployed commit or build is not the approved one.

Other errors are **recorded, not acted on**, to form the baseline for any later numeric threshold.

`rollout-canary-and-rollback.md` (Stage 1, "Abort") also lists *any* `FALLBACK_PIPELINE_ERROR`,
*any* `resolutionsUnverified > 0`, and an admin-confirmed wrong filled segment.
`resolutionsUnverified > 0` and `serveUnverified: true` are covered by items 1–2. A filled
segment an admin confirms is wrong means rejecting that resolution, as the existing plan says.

#### `FALLBACK_PIPELINE_ERROR` (owner decision, 2026-10-04)

A `FALLBACK_PIPELINE_ERROR` is **not** an automatic hard abort. By design it degrades to
engine-only output (`164c9f9`), so on its own it is not a user-visible failure. For this
canary, this policy replaces the "any `FALLBACK_PIPELINE_ERROR`" line in
`rollout-canary-and-rollback.md`:

| Case | Action |
|---|---|
| Isolated error; normal conversion output returned; no privacy or security issue | **Record and investigate** |
| Repeated or systemic errors | **Hard abort** |
| The error causes missing or incorrect normal output | **Hard abort** (item 6) |
| Application instability | **Hard abort** (item 5) |
| Unexpected exposure of user or model data | **Hard abort** (item 3) |
| Evidence the fallback path bypasses its safety controls | **Hard abort** |

There is still no numeric threshold for the first canary.

## Release gate: build and project verification (owner-approved, 2026-10-04)

The Preview release must prove from the actual deployed artifacts that:

- `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` is **on**;
- `SERVE_UNVERIFIED_AI` is **off**;
- the Firebase project ID is the **approved staging project**.

A string in a bundle proves the configuration only. All four checks are required:

1. **Client bundle:** the inlined `NEXT_PUBLIC_FIREBASE_PROJECT_ID` is the staging ID.
2. **Server/runtime configuration:** the Admin SDK's project ID (`FIREBASE_ADMIN_PROJECT_ID`)
   is the staging ID.
3. **Vercel Preview environment:** the canary branch's `NEXT_PUBLIC_FIREBASE_*` and
   `FIREBASE_ADMIN_*` variables are the staging values.
4. **Controlled Firestore operation:** a controlled write and read-back from the deployed
   Preview lands in the staging project and is absent from Production. This is the strongest
   of the four checks.

Tooling built in Phase 10 (`docs/staging-environment.md` §7): check 1 is
`npm run check:release-artifact`, checks 2 and 4 are `/api/admin/firebase-identity`
(GET and POST) plus `npm run staging:firebase -- probe`. None of it has run against a
staging project yet, because none exists (`docs/release-record-phase10.md`).

## Stage 1 execution log

Not started. Steps 1–6 of the Phase 9 brief will be recorded here, with evidence.
