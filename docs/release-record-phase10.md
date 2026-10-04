# Release record: Phase 10, staging Firebase provisioning

**Final status: STAGING INFRASTRUCTURE NOT READY.** The isolation tooling is
built and tested. The staging project itself does not exist: creating it
needs the owner's Google account, and this checkout has none signed in.
Stage 1 is not deployed. Production is unchanged.

Procedure and reference: `docs/staging-environment.md`.

## A. Baseline (2026-10-04)

| | |
|---|---|
| Branch | `feat/font-conversion-hardening` |
| HEAD at start | `62456b2` (owner's `FALLBACK_PIPELINE_ERROR` policy, one past the Phase 9 record `58cfe2e`) |
| Working tree at start | clean |
| Firebase CLI | 15.30.0, **no authorized account** (`firebase login:list`) |
| `gcloud` / `vercel` CLIs | not installed |
| `.firebaserc` | none; nothing in the repo selects a project implicitly |

## B. Staging project

**Not created.** No project id, number or services to record. The owner's
steps are in `staging-environment.md` §9. Services required, from the code:
Firestore, Authentication (Google, Email/Password) and Storage. Nothing else.

## C. Firestore

Not provisioned, because there is no project. Prepared:

- **Rules:** `firestore.rules` and `storage.rules` reviewed. Both default-deny.
  No public write; the only client write is owner-only `users/{uid}`. No
  project id appears in either.
- **Indexes:** the 21 in `firestore.indexes.json`, all in use.
- **TTL:** `expireAt` on `conversionFailures`, `failurePatterns`,
  `rateLimitWindows`, `aiCallBudget` and `stagingProbes`. Not on
  `aiResolutions`. Kept out of the shared indexes file so it cannot reach
  Production ahead of its redaction step.
- **Fixture:** one open pattern and one accepted resolution, `¤ → ক` in Bijoy.
  Smoke input `Av¤Kv`. A test proves it renders both approved labels.

All of it is applied by `npm run staging:firebase -- deploy|ttl|seed --apply`.

## D. Credentials

No service account was created. Specified in `staging-environment.md` §5: a
dedicated account in the staging project with `roles/datastore.user`,
`roles/firebaseauth.admin` and `roles/storage.objectAdmin`. No Owner or Editor,
and nothing on `legacy2uni`. No key was generated, viewed or stored.

## E. Environment isolation

| Environment | Firebase project | Pipeline | Unverified AI |
|---|---|---|---|
| Local / development | `legacy2uni` via `.env.local` (unchanged); staging scripts read only `.env.staging.local`, which does not exist yet | OFF | OFF |
| Preview / staging | `<STAGING_PROJECT_ID>`: **not created**; Vercel Preview not configured | OFF | OFF |
| Production | `legacy2uni` | OFF | OFF |

## F. Artifact verification

Run on the local build (`npm run build`, 38 pages, built from `.env.local`):

| Check | Result |
|---|---|
| `check:release-artifact --environment production --expect-pipeline off --expect-firebase-project legacy2uni` | **PASS** |
| same build as `--environment preview --expect-firebase-project legacy2uni-staging` | **FAIL, as it must**: the bundle targets `legacy2uni`, and `legacy2uni` appears in a client chunk |
| `--environment preview --expect-firebase-project legacy2uni` | **refused**: *Refusing staging operation: target project is the Production Firebase project.* |
| pipeline | OFF (unset at build time) |
| `SERVE_UNVERIFIED_AI` | absent from every browser chunk (runtime read only) |
| `check:client-flags --expect-pipeline off` | PASS |

A passing Preview check needs a build with the staging values, which needs
the staging project.

## G. Connectivity verification

**Not performed.** There is no staging project to write to, and the probe
refuses `legacy2uni`. Ready to run: `npm run staging:firebase -- probe
--apply` locally, and `POST /api/admin/firebase-identity` from the deployed
Preview.

## H. Production safety

| Question | Answer |
|---|---|
| Production Firebase touched? | **No.** No Firebase command ran against any project; the CLI had no account. |
| Production data changed? | **No** |
| Production rules changed? | **No** |
| Production indexes changed? | **No** |
| Production TTL changed? | **No** |
| Production credentials changed? | **No.** `.env.local` was not read or modified. |
| Production Vercel configuration changed? | **No.** No Vercel access. |
| Rollout flag enabled? | **No.** Both off; `SERVE_UNVERIFIED_AI` off. |

## What changed in the repository

| Commit | Change |
|---|---|
| `7d98fcb` | `lib/firebase/projectGuard.ts`: the fail-closed staging-target guard |
| `16af6ed` | `lib/firebase/admin.ts`: on `VERCEL_ENV=preview`, the Admin SDK throws instead of initializing against `legacy2uni`. **This is a runtime change.** Production and local runs are unaffected. A Preview deployment still configured for `legacy2uni` will have its Firebase-backed routes fail with the refusal, by design. |
| `0810609` | `scripts/firebaseTarget.mjs`: the script-side guard, cross-checking the Admin SDK variables |
| `34ffb8f` | `scripts/checkReleaseArtifact.mjs` + `npm run check:release-artifact` |
| `ee451a0` | `scripts/fixtures/stagingFixtures.mjs`: the synthetic accepted resolution |
| `b42dbe6` | `scripts/stagingFirebase.mjs` + `npm run staging:firebase`: deploy, ttl, seed, unseed, probe. Dry run by default. |
| `45fb46c` | `GET`/`POST /api/admin/firebase-identity`: runtime identity and a controlled probe; admin-only; the probe refuses Production |
| `7975ab0` | `.env.staging.local.example` (empty) and its gitignore exception |
| `0ba6120` | retention invariant: the probe route is a known `expireAt` writer, on its own collection |
| `1f873c2` | test emails built from parts, so the working-tree secret scan needs no exemption |
| `4473e32` | `docs/staging-environment.md` |
| `e2616eb` | (owner's commit, "uupe1") stale-pointer updates in `release-record-phase9.md` (release gate) and `dev-environment.md` §7 |

Validation at the end: `tsc` pass, lint pass, **1,866 tests / 109 files** pass
(104 new), build pass (38 pages), `scan:secrets` no unexpected finding.

`scan:secrets:history` reports 9 `service-account-email` matches. All are in
this phase's own test commits (`7d98fcb`, `16af6ed`, `0810609`, `b42dbe6`) and
are synthetic addresses written for the tests (`firebase-adminsdk-x1@legacy2uni…`,
`convert2uni-server@legacy2uni-staging…`, `x@someone-else…`). None is a real
account or credential. HEAD no longer contains them. History is not rewritten,
per the standing rule.

## I. Remaining blockers before Phase 11

1. **The staging project.** The owner creates it and enables the three services
   (`staging-environment.md` §9 steps 1–2).
2. **Staging service account and key** (§5), stored only in Vercel Preview and
   `.env.staging.local`.
3. **`firebase login`** by the owner, then `deploy`, `ttl`, `seed`, `probe`
   with `--apply`.
4. **Vercel access** to set the Preview-scoped variables (§6). Release-owner
   authorization is needed for that change, and it has not been given.
5. Re-run `check:release-artifact --environment preview` on a staging build,
   then checks 2–4 of the release gate against the deployed Preview.

## J. Final status

```text
STAGING INFRASTRUCTURE NOT READY
STAGE 1 PREVIEW: NOT DEPLOYED
PRODUCTION: UNCHANGED
SERVE_UNVERIFIED_AI: OFF
```
