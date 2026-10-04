# Staging environment (Phase 10)

The isolated Firebase project the Stage 1 Preview canary runs against. It is
provisioned by the release owner and verified with the tooling below.
**Nothing in this document authorizes a deploy or a flag change.** That is
Phase 11.

> A staging setup that can accidentally write to `legacy2uni` is not a
> staging setup.

## 1. The two projects

| | Project id | Role |
|---|---|---|
| **Production** | `legacy2uni` | **PRODUCTION: DO NOT USE FOR STAGING.** Read-only for everything in this document. |
| **Staging** | `<STAGING_PROJECT_ID>`: *not yet created* | **STAGING / PREVIEW ONLY.** |

Record the staging id, project name and project number here once the owner
creates the project. Suggested id: `legacy2uni-staging`, or
`legacy2uni-preview-<suffix>` if that is taken. Any id passes the guard except
`legacy2uni` itself, a malformed id, or an emulator-only `demo-*` id.

Status at the end of Phase 10: **not created.** The Firebase CLI in this
checkout has no signed-in account, `gcloud` is not installed, and creating a
Google Cloud project needs the owner's Google account (§9).

## 2. What the application needs from Firebase

Taken from the code, not from a template.

| Service | Used for | Needed in staging |
|---|---|---|
| Cloud Firestore (Native mode) | every collection in `firestore.rules` | yes |
| Authentication: **Google** and **Email/Password** providers | `components/auth/AuthProvider.tsx`, `lib/firebase/client.ts` | yes; also add the Preview deployment's domain under *Authorized domains* or Google sign-in will refuse it |
| Cloud Storage (default bucket) | uploaded documents, written through the Admin SDK (`lib/firebase/recordActivity.ts`, `deleteDocumentUpload.ts`) | yes |
| Cloud Functions, Realtime Database, Analytics, Messaging, App Check, Remote Config | not referenced anywhere | **no; do not enable** |

The repo pins no Firestore location. Pick the same region as Production so
latency and behaviour match, and record it in §1.

## 3. Rules, indexes, TTL

All three come from the files Production uses, deployed to staging only, by
`scripts/stagingFirebase.mjs`. It takes the target from
`STAGING_FIREBASE_PROJECT_ID` and nowhere else, refuses `legacy2uni`, and
passes `--project` explicitly on every call. It never relies on `firebase use`
or `.firebaserc` (there is none). **It is a dry run unless given `--apply`.**

```bash
cp .env.staging.local.example .env.staging.local   # fill in; gitignored
npm run staging:firebase -- deploy            # prints the command
npm run staging:firebase -- deploy --apply    # firebase deploy --only firestore:rules,firestore:indexes,storage --project <staging>
npm run staging:firebase -- ttl --apply       # gcloud firestore fields ttls update expireAt ... --project=<staging>
```

**Rules** (`firestore.rules`, `storage.rules`), reviewed for Phase 10:
default-deny, and no collection grants a client write except `users/{uid}`,
where only the owner can write and the server re-derives `tier` (comment in
the file). Server writes go through the Admin SDK, which bypasses rules. The
rules name no project, so nothing in them can point at Production. Tests to
run after deploying, against staging (§7): an anonymous read of
`aiResolutions` is denied; an admin read is allowed; any client write to
`failurePatterns` is denied.

**Indexes:** the 21 composite indexes in `firestore.indexes.json`, unchanged.
All are used by queries in `lib/firebase/*`. `--non-interactive` without
`--force` means an index present in staging but absent from the file is
reported, never deleted.

**TTL:** a policy on `expireAt` for each collection the app stamps:

| Collection | Stamped by | Retention |
|---|---|---|
| `conversionFailures` | `lib/conversionFailures/retention.ts` | fixed, from `createdAt` |
| `failurePatterns` | same | sliding, from `lastSeenAt` |
| `rateLimitWindows` | `lib/security/sharedRateLimit.ts` | end of the window |
| `aiCallBudget` | `lib/ai/costCap.ts` | 35 days after the budget day |
| `stagingProbes` | the probe (§7) | 1 day; staging only |

`aiResolutions` gets **no** policy, deliberately (`pending-manual-steps.md` §5).
The redact-then-backfill order in `pending-manual-steps.md` §1 is a Production
concern: a new staging project has no legacy rows, so its TTL policies can go
on first. TTL is not declared in `firestore.indexes.json` on purpose. That file
is shared with Production, and a TTL entry there would reach Production on the
next index deploy, ahead of its redaction step.

If `gcloud` is not available, create the same five policies in the console:
Firestore → TTL → Create policy, field `expireAt`. Check the project
selector reads the staging id first.

## 4. Staging data

Only synthetic data, seeded by `npm run staging:firebase -- seed --apply`
from `scripts/fixtures/stagingFixtures.mjs`:

| Document | What it is |
|---|---|
| `failurePatterns/staging-fixture-bijoy-u00a4` | an `open` pattern for the Bijoy byte `¤` (U+00A4), which the engine does not map |
| `aiResolutions/staging-fixture-bijoy-u00a4-accepted` | an **accepted** resolution `¤ → ক`, reviewer `staging-fixture`, no provider called |

Smoke input: **`Av¤Kv`** (Bijoy), with the encoding set to Bijoy. With the
pipeline on, the `¤` segment is filled with `ক` and marked
**Accepted using AI-assisted fallback** /
**AI-সহায়ক বিকল্প পদ্ধতিতে গ্রহণ করা হয়েছে**.
`lib/firebase/__tests__/stagingFixtures.script.test.ts` proves this end to end
from the fixture rows, through the `/known` route, to the rendered panel.

Nothing else is seeded. Counters, rate-limit windows and budget documents are
created by the app on first use, as in Production. Test users are created by
signing in. The first admin is granted with `scripts/setAdminClaim.mjs`, run
with `.env.staging.local` loaded (`node --env-file=.env.staging.local
scripts/setAdminClaim.mjs <uid>`), **never with `.env.local`**. No Production
document, user or credential is copied. `unseed --apply` removes exactly the
two fixture documents.

## 5. Service account

The Admin SDK needs one credential: a service account **of the staging
project**.

- Create a dedicated account in the staging project, e.g.
  `convert2uni-server@<staging-id>.iam.gserviceaccount.com`. Do not use
  the default `firebase-adminsdk` account if you can avoid it, and never the
  Production one.
- Grant it **Cloud Datastore User** (`roles/datastore.user`, Firestore
  read/write), **Firebase Authentication Admin**
  (`roles/firebaseauth.admin`, needed for ID-token verification and
  `setAdminClaim`), and **Storage Object Admin**
  (`roles/storage.objectAdmin`) on the default bucket only. Do not grant
  Owner or Editor.
- Grant it **nothing** on `legacy2uni`. Confirm in the Production project's
  IAM page that the account's email does not appear.
- Create one JSON key. Put its three fields into Vercel Preview (§6) and, if
  needed, into `.env.staging.local`. Delete the downloaded file. Never paste
  it into chat, a doc, a fixture or a commit.

Deploying rules, indexes and TTL is done with the owner's own signed-in
CLI, not this account. The account cannot change rules or IAM.

## 6. Environment variables

Every variable the code reads, by where it is visible. Values are never
written here.

| Variable | Visibility | Secret | Preview / staging value | Production |
|---|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | browser (inlined at build) | no¹ | staging web app config | unchanged |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | browser | no | `<staging-id>.firebaseapp.com` | unchanged |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | browser | no | `<staging-id>` | `legacy2uni` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | browser | no | staging bucket | unchanged |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | browser | no | staging config | unchanged |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | browser | no | staging config | unchanged |
| `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` | browser | no | **unset in Phase 10**; `true` only in Phase 11 | unset |
| `FIREBASE_ADMIN_PROJECT_ID` | server | no | `<staging-id>` | `legacy2uni` |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | server | no | staging service account | unchanged |
| `FIREBASE_ADMIN_PRIVATE_KEY` | server | **yes** | staging key | unchanged |
| `FIREBASE_ADMIN_STORAGE_BUCKET` | server | no | staging bucket | unchanged |
| `SERVE_UNVERIFIED_AI` | server only, never in a bundle | no | **unset / `false`** | unset |
| `AI_RESOLUTION_ENABLED` | server | no | **unset** (the canary needs no provider call) | unchanged |
| `AI_DAILY_CALL_BUDGET` | server | no | unset | unchanged |
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | server | **yes** | **unset**; if ever needed, separate staging keys | unchanged |
| `VERCEL`, `VERCEL_ENV` | server, set by Vercel | no | `preview` | `production` |
| `NEXT_PUBLIC_USE_FIREBASE_EMULATOR`, `FIRESTORE_EMULATOR_HOST` | local only | no | **unset** | unset |
| `STAGING_FIREBASE_PROJECT_ID` | staging scripts only | no | `<staging-id>` in `.env.staging.local` | never set |

¹ A Firebase web API key identifies the project and is public by design.
Access is controlled by rules and Auth, not by keeping it hidden.

**Vercel (not changed in Phase 10).** Every row above goes in the
**Preview** environment, scoped to the canary branch
(`feat/font-conversion-hardening`), not to "All Preview branches". The
**Production** environment's values stay exactly as they are, on
`legacy2uni`. When adding a Preview value in the Vercel UI, untick
*Production* and *Development*. The default is to tick all three, and that
is how a staging value would overwrite Production. The `NEXT_PUBLIC_*` values
are inlined at build time, so a change needs a rebuild of the Preview.

**Locally:** `.env.local` points at Production and is left alone.
`.env.staging.local` (template: `.env.staging.local.example`) is read **only**
by the staging scripts. Next.js does not load it, so `npm run dev` cannot pick
it up by accident.

## 7. Isolation safeguards and verification

| Layer | Safeguard | Where |
|---|---|---|
| Guard | `legacy2uni`, missing, malformed and `demo-*` ids refused as a staging target, with *"Refusing staging operation: target project is the Production Firebase project."* | `lib/firebase/projectGuard.ts`, `scripts/firebaseTarget.mjs` (kept in step by test) |
| Scripts | target only from `STAGING_FIREBASE_PROJECT_ID`; Admin SDK project and service-account email must match it; emulator host refused; dry run by default; explicit `--project` | `scripts/stagingFirebase.mjs` |
| Build artifact | Preview artifact fails if its inlined `projectId` is not the staging id, if `legacy2uni` appears in **any** client chunk (auth domain, bucket), if the pipeline flag is wrong, or if `SERVE_UNVERIFIED_AI` can reach a browser. A production artifact must target `legacy2uni`. | `npm run check:release-artifact` |
| Server runtime | on `VERCEL_ENV=preview`, the Admin SDK **throws instead of initializing** if its project or service account is `legacy2uni` | `lib/firebase/admin.ts` |
| Runtime check | `GET /api/admin/firebase-identity` (admin only) returns the running deployment's client project, Admin SDK project and service-account project. Ids only. | `app/api/admin/firebase-identity/route.ts` |
| Controlled write | `POST` on the same route writes and reads back one synthetic `stagingProbes` document, and **refuses on `legacy2uni`** whatever the deployment calls itself | same |

The four release-gate checks (`release-record-phase9.md`), once staging exists:

```bash
# 1. Client bundle (after building with the Preview's env)
npm run check:release-artifact -- --environment preview \
  --expect-pipeline off --expect-firebase-project <staging-id>
# 2. Server runtime: as an admin of the deployed Preview
curl -H "Authorization: Bearer <admin ID token>" https://<preview-url>/api/admin/firebase-identity
#    expect adminProjectId = serviceAccountProjectId = clientProjectId = <staging-id>, targetsProduction false
# 3. Vercel Preview env: read each row of §6 in the Vercel UI, Preview scope
# 4. Controlled write: from the deployed Preview, and locally against staging
curl -X POST -H "Authorization: Bearer <admin ID token>" https://<preview-url>/api/admin/firebase-identity
npm run staging:firebase -- probe --apply
#    then: the probe id is in staging's stagingProbes; legacy2uni has no stagingProbes collection
```

Step 4's absence check in Production is a **read** in the console, never a write.

## 8. CI/CD

The only workflow is `.github/workflows/playwright.yml`. It runs Playwright
on pushes and PRs to `main`/`master`, deploys nothing and holds no Firebase
secret. Vercel's Git integration does the deploying, and its environment
scoping (§6) is the Preview/Production separation. No automated staging
deployment is added. Rules, indexes and TTL go to staging only through the
guarded script, run by hand.

## 9. What the owner has to do (cannot be done from this checkout)

1. Create the Google Cloud / Firebase project (§1). Record id, name, number
   and Firestore region here.
2. Enable Firestore (Native, same region as Production), Authentication
   (Google + Email/Password, plus the Preview domain as an authorized
   domain), and Storage. Nothing else.
3. Register a web app and copy its config into Vercel **Preview** (§6).
4. Create the service account and key (§5). Put them in Vercel Preview and,
   for the scripts, in `.env.staging.local`.
5. `firebase login`, then run `deploy`, `ttl`, `seed` with `--apply` (§3–4).
   Each prints the staging project before acting.
6. Run `probe --apply`, then check §7 step 4 in both consoles.

## 10. Rollback and removal

- **Fixture:** `npm run staging:firebase -- unseed --apply`.
- **Vercel:** delete the Preview-scoped Firebase variables. Production
  variables are separate and untouched.
- **Whole environment:** delete the staging project in the Google Cloud
  console (30-day recovery window), then delete its service-account key
  everywhere it was stored. Nothing in `legacy2uni` refers to staging, so
  there is nothing to undo there.
- **Code:** the guards only refuse, so leaving them in place costs nothing.
