# Release record — Phase 11 (staging provisioning)

Date: 2026-10-04. Result: **blocked at the first prerequisite.** Nothing was
run against any Firebase, Google Cloud or Vercel project.

## A. Baseline

| | |
| --- | --- |
| Branch | `feat/font-conversion-hardening` |
| Starting commit | `e81a58a` (Phase 10 record, clean working tree) |
| Ending commit | the commit adding this file (docs only) |
| `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` | unset in every env file → OFF |
| `SERVE_UNVERIFIED_AI` | unset in every env file → OFF |
| `.env.staging.local` | still the empty Phase 10 template, untracked |

## The blocker

| Prerequisite | State |
| --- | --- |
| `firebase --version` | 15.30.0 |
| `firebase login:list` | **No authorized accounts** |
| `gcloud` | **not installed** |
| `vercel` | **not installed**; no `.vercel` link |
| Staging project | **does not exist** (no id to verify) |

`firebase login` is a browser OAuth flow for the owner's Google account and
cannot be completed from this non-interactive session. Without it, and
without a project, sections B–G of the brief have nothing to run against.
None were attempted, guessed or simulated.

## What the owner has to do

Unchanged from [staging-environment.md §9](staging-environment.md#9-what-the-owner-has-to-do-cannot-be-done-from-this-checkout):

1. Create a separate Google Cloud/Firebase project, e.g.
   `legacy2uni-staging`. Record its id and number.
2. Enable Firestore (Native, same region as Production), Authentication
   (Google + Email/Password) and Storage. Nothing else.
3. Register a web app. Create the staging-only service account with
   `roles/datastore.user`, `roles/firebaseauth.admin` and
   `roles/storage.objectAdmin` (default bucket). Fill `.env.staging.local`
   locally. Never paste values into chat.
4. Run `firebase login` in an interactive terminal. Optionally install
   `gcloud` (for IAM/TTL verification) and `vercel` (for Preview env).
5. Start Phase 11 again. The `deploy`, `ttl`, `seed` and `probe --apply`
   steps, the identity checks and the artifact checks are then mechanical.

## H. Production safety

```text
Production Firebase data: unchanged
Production Firebase rules: unchanged
Production Firebase indexes: unchanged
Production Firebase TTL: unchanged
Production Firebase credentials/IAM: unchanged
Production Vercel configuration: unchanged
```

No CLI could reach any project. The only change is this file.

## I. Automated verification

Not re-run. The code at `e81a58a` is the code Phase 10 verified (1866
tests/109 files, tsc/lint/build clean, 38 pages), and this phase only
changes docs.

## J. Release state

```text
STAGING INFRASTRUCTURE: BLOCKED — no staging project; Firebase CLI not signed in; gcloud/vercel absent
STAGE 1 PREVIEW: NOT DEPLOYED
PRODUCTION: UNCHANGED
SERVE_UNVERIFIED_AI: OFF
NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE: OFF
```
