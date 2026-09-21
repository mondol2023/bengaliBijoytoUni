# Development environment: keeping local work off the production project

**Status: implemented, partly unverified.** The configuration, the scripts and the code
branches are in. The Firestore and Storage emulators **could not be started in this
environment** — there is no JDK on this machine — so everything marked UNVERIFIED below is
written from the installed tooling's own source rather than from a run. §6 says exactly what
was and was not observed.

`.env.local` was not read, modified or copied at any point.

## 1. What this fixes

`npm run dev` reads `.env.local`, and `.env.local` holds production credentials — the web app
config and an Admin SDK service account with full Firestore, Auth and Storage access
(`lib/firebase/admin.ts` reads `FIREBASE_ADMIN_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY`
at module load). So every local action that happens to hit a Firestore-touching route writes a
real production row:

| Route | What a local click writes to production |
| --- | --- |
| `POST /api/conversion-failures` | `conversionFailures` occurrences and `failurePatterns` counters |
| `POST /api/conversions`, `/api/comparisons`, `/api/documents` | activity/usage records |
| `POST /api/auth/session`, `GET /api/users/me` | session + profile reads/writes |
| `/api/admin/*` | audit entries, user records, AI resolution documents |

The `failurePatterns` case is the one that matters. `occurrenceCount` is incremented with
`FieldValue.increment()` in a transaction (`lib/firebase/conversionFailures.ts`), so a
developer pasting the same broken sample forty times while working on the converter silently
inflates the production frequency data — the data the admin triage UI ranks by. It is not a
security problem; it is a *corrupted-measurement* problem, and it does not announce itself.

The unit suite was never the gap and still isn't: Vitest does not load `.env.local`,
`vitest.config.ts` imports no dotenv, and Firestore-touching modules are mocked. The gap is
`npm run dev` and anything driven through a browser.

## 2. Quick start

```bash
cp .env.development.local.example .env.development.local   # no edits needed
npm run emulators                                          # terminal 1
npm run dev:emulated                                       # terminal 2
```

`npm run dev` is unchanged and still points at whatever `.env.local` holds. Deleting
`.env.development.local` restores the previous behaviour exactly.

Requires a **JDK 21 or newer** on the PATH — see §3.

## 3. The JDK requirement, verified rather than assumed

The Firestore and Storage emulators are Java programs. The commonly cited requirement is Java
11; for the CLI actually installed here it is **21**, and it is a hard failure, not a warning.

Evidence, from the installed `firebase-tools@15.30.0` (`firebase --version` reports `15.30.0`,
resolved at `%APPDATA%/npm/node_modules/firebase-tools`):

```
lib/emulator/commandUtils.js:390
  exports.MIN_SUPPORTED_JAVA_MAJOR_VERSION = 21;
lib/emulator/commandUtils.js:391
  exports.JAVA_DEPRECATION_WARNING = "firebase-tools no longer supports Java version before 21. "
    + "Please install a JDK at version 21 or above to get a compatible runtime.";

lib/emulator/controller.js:180-183
  if (targets.some(downloadableEmulators_1.requiresJava)) {
      if ((await commandUtils.checkJavaMajorVersion()) < commandUtils_1.MIN_SUPPORTED_JAVA_MAJOR_VERSION) {
          throw new error_1.FirebaseError(commandUtils_1.JAVA_DEPRECATION_WARNING);
      }
  }
```

Which emulators trigger that check, from `requiresJava()` in
`lib/emulator/downloadableEmulators.js`, evaluated directly against the installed module:

| Emulator | Needs Java |
| --- | --- |
| `firestore` | **yes** |
| `storage` | **yes** |
| `auth` | no |
| `ui` | no |

So `--only auth` works with no JDK at all; the pair this project actually needs does not.
Pin the requirement to the CLI, not to this document: if `firebase-tools` is upgraded, re-read
`MIN_SUPPORTED_JAVA_MAJOR_VERSION` before trusting the number above.

## 4. Why `.env.development.local`, and why it is enough

Next's env loading was read out of the installed `@next/env@16.3.5`
(`node_modules/@next/env/dist/index.js`, `loadEnvConfig`), not from memory:

```js
const d = isTest ? "test" : dev ? "development" : "production";
const f = [`.env.${d}.local`, d !== "test" && `.env.local`, `.env.${d}`, ".env"].filter(Boolean);
```

and, in `processEnv`, a key is taken from a file only when nothing has defined it yet:

```js
if (typeof u[t] === "undefined" && typeof p[t] === "undefined") { u[t] = e.parsed[t]; }
```

Three consequences, all of which this setup depends on:

1. **For `next dev` the order is `.env.development.local` → `.env.local` → `.env.development`
   → `.env`, and the first file to define a key wins.** So an override file beats `.env.local`
   without `.env.local` being touched.
2. **It is per key, not per file.** A key the override file leaves out still falls through to
   `.env.local`'s production value. This is why `.env.development.local.example` sets *every*
   credential key, blanking the two Admin SDK secrets rather than omitting them — a blank
   string is still "defined" and still wins.
3. **A variable already in the real environment beats every file** (`p` is the process env
   snapshot). Exporting `FIRESTORE_EMULATOR_HOST` in a shell therefore also works, and cannot
   be undone by a file.

Worth knowing, though nothing here relies on it: under `NODE_ENV=test`, `.env.local` is
dropped from the list entirely.

## 5. What is in the tree

| File | What it does |
| --- | --- |
| `firebase.json` → `emulators` | Ports for auth/firestore/storage/UI, plus `singleProjectMode`. The rules files already declared there are picked up automatically, so `firestore.rules` and `storage.rules` are enforced locally. |
| `.env.development.local.example` | The override file, ready to copy. Tracked on purpose (a `!` exception in `.gitignore`), and checked by Guard A like every other example file. |
| `lib/firebase/admin.ts` | Emulator branch: when `FIRESTORE_EMULATOR_HOST` is set, `initializeApp({ projectId })` with **no** credential, and `isFirebaseAdminConfigured` is true without a service account. `cert()` rejects a fake private key, so dummy credentials were not an option. |
| `lib/firebase/client.ts` | `connectAuthEmulator` / `connectFirestoreEmulator` / `connectStorageEmulator`, gated on `NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "1"` and called once per cached instance — calling one twice on the same object throws, which is the bug that would otherwise appear only after a fast refresh. |
| `scripts/requireEmulatorEnv.mjs` | `dev:emulated` refuses to start if `.env.development.local` is missing, because the failure it prevents is silent: the app comes up looking normal and writes to production. Read-only; it stats one path. |
| `npm run emulators` | `firebase emulators:start --project demo-convert2uni --only auth,firestore,storage`. |
| `npm run dev:emulated` | The guard, then `next dev`. |

### The `demo-` prefix is load-bearing

`Constants.FAKE_PROJECT_ID_PREFIX = "demo-"` (`lib/emulator/constants.js:99`). A project id
with that prefix makes the CLI operate fully offline and refuse to reach Google even by
accident. Observed in the run in §6:

```
i  emulators: Detected demo project ID "demo-convert2uni", emulated services will use a
   demo configuration and attempts to access non-emulated services for this project will fail.
```

### Ports

From `DEFAULT_PORTS` in `lib/emulator/constants.js` — UI 4000, hub 4400, logging 4500,
firestore 8080, auth 9099, storage 9199. `firebase.json` states them explicitly anyway, and
`lib/firebase/client.ts` hard-codes the same three. **If you change a port, change both.**

### Admin SDK emulator variables

Verified by grep in `node_modules`, because the naming is not consistent between services:

| Service | Variable | Form | Read by |
| --- | --- | --- | --- |
| Firestore | `FIRESTORE_EMULATOR_HOST` | `host:port` | `@google-cloud/firestore` |
| Auth | `FIREBASE_AUTH_EMULATOR_HOST` | `host:port` | `firebase-admin@14.4.0` |
| Storage | `FIREBASE_STORAGE_EMULATOR_HOST` | `host:port`, **no scheme** | `firebase-admin/lib/storage/storage.js:43-51`, which rewrites it into `STORAGE_EMULATOR_HOST` with `http://` prepended |

## 6. What was actually observed here, and what was not

**Verified.** `firebase.json` parses and the emulator suite starts:

```
$ firebase emulators:start --project demo-convert2uni --only auth
i  emulators: Starting emulators: auth
i  emulators: Detected demo project ID "demo-convert2uni", ...
+  All emulators ready! It is now safe to connect your app.
i  View Emulator UI at http://127.0.0.1:4000/
| Authentication | 127.0.0.1:9099 | http://127.0.0.1:4000/auth |
```

**UNVERIFIED.** Firestore and Storage never started, so nothing downstream of them was
exercised:

```
$ firebase emulators:start --project demo-convert2uni --only auth,firestore,storage
i  emulators: Shutting down emulators.
Error: Could not spawn `java -version`. Please make sure Java is installed and on your system PATH.
```

Specifically not verified:

- that `lib/firebase/admin.ts`'s credential-free branch successfully reads and writes
  Firestore;
- that `connectFirestoreEmulator` / `connectStorageEmulator` route the browser SDK correctly
  in this app;
- that `firestore.rules` and `storage.rules` load and behave as they do in production;
- that `firestore.indexes.json` is accepted by the emulator.

`npx tsc --noEmit`, `npm run lint`, the unit suite and `npm run build` all pass with these
changes, which is type-level and behavioural coverage of the non-emulator path only — none of
it starts an emulator.

**To finish the verification:** install a JDK 21+, `npm run emulators`, then in another
terminal `cp .env.development.local.example .env.development.local && npm run dev:emulated`.
Paste legacy text containing a sequence that fails, and confirm a `conversionFailures`
document appears in the Emulator UI at `http://127.0.0.1:4000/firestore` and **not** in the
production console. Then move the four bullets above into the verified list.

## 7. Still open

- **A production-write guard.** A startup check refusing to initialize the Admin SDK against
  the production project id when `NODE_ENV !== "production"` unless `ALLOW_PRODUCTION_WRITES=1`
  is set. Roughly ten lines in `lib/firebase/admin.ts`. Worth having even with the emulator,
  because the emulator protects you when it is running and configured, and this protects you
  on the day the env var is missing — which is the day the accident happens. **Proposed, not
  built**: it changes what `npm run dev` does against a real project, which is a decision
  rather than a cleanup.
- **A staging project** (the previous revision's Option 2), for "does this work deployed",
  which the emulator is honest about not answering. Deferred, per the decision to do the
  emulator now and staging later.
- **Seed data.** `firebase emulators:start --import ./emulator-data --export-on-exit` would
  make a local dataset persist between runs. Not set up; `/emulator-data/` is gitignored ready
  for it.
