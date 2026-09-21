# Development environment: keeping local work off the production project

**Status: proposal. Nothing in this document has been done.** No file outside this one was
changed to write it, `.env.local` was not read, modified, or copied, and no command in it was
run. It exists to be approved, rejected, or amended.

## What is actually at risk today

`npm run dev` reads `.env.local`, and `.env.local` holds production credentials — the web app
config and an Admin SDK service account with full Firestore, Auth, and Storage access
(`lib/firebase/admin.ts` reads `FIREBASE_ADMIN_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY`
at module load). So every local action that happens to hit a Firestore-touching route writes a
real production row. Those routes are:

| Route | What a local click writes to production |
| --- | --- |
| `POST /api/conversion-failures` | `conversionFailures` occurrences and `failurePatterns` counters |
| `POST /api/conversions`, `/api/comparisons`, `/api/documents` | activity/usage records |
| `POST /api/auth/session`, `GET /api/users/me` | session + profile reads/writes |
| `/api/admin/*` | audit entries, user records, AI resolution documents |

The `failurePatterns` case is the one that actually matters. `occurrenceCount` is incremented
with `FieldValue.increment(1)` in a transaction (`lib/firebase/conversionFailures.ts`), so a
developer pasting the same broken sample forty times while working on the converter silently
inflates the production frequency data — the exact data Phase 3 item 4 is about to start
ranking by, and Phase 5 would prioritize work from. It is not a security problem; it is a
*corrupted-measurement* problem, and it does not announce itself.

### What is already safe, verified rather than assumed

The unit suite cannot reach the live project. Vitest does not load `.env.local` into
`process.env`, and `vitest.config.ts` imports no dotenv. Probed directly by running a
throwaway test in this repo (since deleted; tree confirmed clean afterwards):

```
ENVPROBE FIREBASE_ADMIN_PROJECT_ID=unset FIREBASE_ADMIN_CLIENT_EMAIL=unset
         FIREBASE_ADMIN_PRIVATE_KEY=unset NEXT_PUBLIC_FIREBASE_PROJECT_ID=unset
         GEMINI_API_KEY=unset OPENAI_API_KEY=unset
ENVPROBE isFirebaseAdminConfigured=false
```

Two independent reasons a test cannot write to production, then: the credentials are not in
the environment, and `getAdminApp()` throws a clear error whenever
`isFirebaseAdminConfigured` is false. Firestore-touching modules are mocked in their tests on
top of that. CI (`.github/workflows/playwright.yml`) sets no Firebase secrets either.

**The gap is `npm run dev` and anything driven through a browser, not the test suite.**

## Option 1 — Firebase Local Emulator Suite (recommended)

Run Firestore, Auth, and Storage locally. Nothing leaves the machine, there is no billing, and
the data is disposable.

What it needs:

1. An `emulators` block in `firebase.json` (which already declares `firestore` rules/indexes
   and `storage` rules, so the emulators pick up the real rules automatically — a genuine bonus:
   rules bugs surface locally instead of in production).
2. A project id. `.firebaserc` does not exist; using `--project demo-convert2uni` is enough,
   and the `demo-` prefix is meaningful to the tooling — it forces fully offline operation and
   refuses to contact Google even by accident.
3. A small change in `lib/firebase/admin.ts`: when `FIRESTORE_EMULATOR_HOST` is set,
   `initializeApp({ projectId })` with no `credential`. Today `isFirebaseAdminConfigured`
   requires all three service-account values, and `cert()` would reject a fake private key, so
   the emulator path needs an explicit branch rather than dummy credentials.
4. A matching client branch — `connectFirestoreEmulator` / `connectAuthEmulator` /
   `connectStorageEmulator`, gated on `NEXT_PUBLIC_USE_FIREBASE_EMULATOR`.
5. `firebase-tools` as a devDependency (or `npx`), plus **a JDK** — the Firestore emulator is a
   Java program. On this Windows machine that is the one real installation cost, and it is the
   reason to decide now rather than mid-phase.

Cost: items 3 and 4 are maybe forty lines of code, both behind explicit env checks, both
reversible. Item 5 is a one-time install.

What it does not catch: real index requirements at production scale, real latency, and real
quota behavior. The emulator is honest about rules and semantics, not about performance.

## Option 2 — a second Firebase project used as staging

Create `convert2uni-staging`, give it its own web app and service account, and point local dev
at it.

The clean way to do that here, **without touching `.env.local`**, is Next.js's own precedence
order: `.env.development.local` is loaded ahead of `.env.local` in `next dev`. So a new
`.env.development.local` holding staging credentials makes `npm run dev` use staging, leaves
`.env.local` byte-identical, and is already ignored by `.gitignore` (`.env*`). No code change
at all.

Cost: a second project to create and keep in sync (rules, indexes, admin claims), and a second
service-account key to store safely — one more credential in existence is a real, if small,
downside. Free tier covers the volume.

What it catches that the emulator does not: real indexes, real rules deployment, real Admin
SDK auth, real latency.

## Option 3 — both

The emulator for daily work, staging for a pre-deploy smoke run. This is the end state I would
aim at, but it is two setups at once and not worth doing in one step.

## Recommendation

**Option 1 now, Option 2 later if a deployment story needs it.**

Phase 3 is the wrong phase to be pointed at real infrastructure. Items 2, 4, and 5 (top-N
snapshot endpoint, admin ordering, write instrumentation) are all about read and write
behavior, and developing them against production means the measurements are of my own test
traffic. The emulator gives real Firestore semantics — transactions, `FieldValue.increment`,
composite index errors, security rules — with disposable data, offline, at zero cost.

Staging is the better answer for "does this work deployed", which is a Phase 5+ question.

## A guard worth adding either way

Independently of which option is chosen: a startup check that refuses to initialize the Admin
SDK against the production project id when `NODE_ENV !== "production"`, unless
`ALLOW_PRODUCTION_WRITES=1` is explicitly set. Roughly ten lines in `lib/firebase/admin.ts`.

The reason to want this even after an emulator exists: the emulator protects you when it is
running and configured. This protects you on the day the env var is missing, which is the day
the accident actually happens.

## Until this is approved

Every Phase 3 test uses mocks. Nothing runs against the live Firebase project, and `.env.local`
is not modified. That is the constraint I am working under, and the verification above is the
evidence that the suite already satisfies it structurally rather than by my remembering to.

## Steps, if Option 1 is approved (not run)

1. `npm i -D firebase-tools`, install a JDK.
2. Add the `emulators` block to `firebase.json` (firestore 8080, auth 9099, storage 9199, UI 4000).
3. Add the emulator branch to `lib/firebase/admin.ts` and the client connect calls to
   `lib/firebase/client.ts`, both env-gated.
4. Add `.env.development.local` (git-ignored) with `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1`,
   `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`,
   `FIREBASE_ADMIN_PROJECT_ID=demo-convert2uni`. `.env.local` is not touched.
5. Add `npm run emulators` and `npm run dev:emulated`.
6. Document it here and in `docs/firebase-setup.md`.
