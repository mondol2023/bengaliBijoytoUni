# Firebase setup

No Firebase project exists yet for this app. Everything in `lib/firebase/*`,
`lib/auth/*`, the auth UI, and the `/api/conversions`, `/api/comparisons`,
`/api/documents*`, and `/api/users/me` routes is wired against environment
variables that don't resolve to anything until you complete the steps below
— until then, `isFirebaseConfigured` / `isFirebaseAdminConfigured` are both
`false`, sign-in is hidden, and every route that needs persistence returns a
clear "isn't set up yet" error instead of crashing.

## 1. Create the project

1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project**.
2. Name it (e.g. `convert2uni`), accept/decline Google Analytics as you prefer — not used by this app.

## 2. Register a web app

1. In the project overview, click the **Web** (`</>`) icon → register an app (no Firebase Hosting setup needed).
2. Copy the `firebaseConfig` values it shows you — these map directly to the `NEXT_PUBLIC_FIREBASE_*` variables in `.env.local.example`.

## 3. Enable Authentication providers

1. **Build → Authentication → Get started**.
2. Enable **Email/Password**.
3. Enable **Google** — set a support email when prompted.

## 4. Create Firestore

1. **Build → Firestore Database → Create database**.
2. Choose **Production mode** (security rules below cover it — do not leave it in test mode).
3. Pick a region.

## 5. Create Storage

1. **Build → Storage → Get started**.
2. Production mode, same region as Firestore.

## 6. Generate a service account (Admin SDK)

1. **Project settings → Service accounts → Generate new private key**.
2. This downloads a JSON file with `project_id`, `client_email`, and `private_key`.
3. Map those into `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` in `.env.local` (copy the `private_key` value as-is, literal `\n` sequences included — `lib/firebase/admin.ts` converts them to real newlines).
4. **Never commit this file or these values.** `.env*` is already gitignored.

## 7. Fill in `.env.local`

```bash
cp .env.local.example .env.local
```

Fill in every value from steps 2 and 6. `FIREBASE_ADMIN_STORAGE_BUCKET` and `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` are the same bucket name (`<project-id>.appspot.com` or `<project-id>.firebasestorage.app`, as shown in the console).

## 8. Deploy security rules and indexes

Install the CLI once if you don't have it, then from the repo root:

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick the project you just created
firebase deploy --only firestore:rules,firestore:indexes,storage:rules
```

This deploys `firestore.rules`, `firestore.indexes.json`, and `storage.rules` from the repo root (already wired up via `firebase.json`) — default-deny, with the composite indexes conversions/comparisons/documents need for `where("userId", "==", uid).orderBy("createdAt", "desc")`.

## 9. Grant your own account admin access (optional, for Phase 7)

There is no in-app way to grant the *first* admin. After you've signed up once through the app's sign-in dialog, find your uid (Authentication tab in the console, or log it from `useAuth().user.uid`), then:

```bash
node scripts/setAdminClaim.mjs <your-uid>
```

Sign out and back in afterward — custom claims are baked into the ID token and only refresh on a new sign-in (or naturally after about an hour).

## 10. Verify

Restart the dev server (env vars are read at process start), then:

- The header should show a **Sign in** button.
- Signing up with email/password or Google should work, and `/account` should show your profile and an (empty) history.
- Uploading a document while signed in should populate `/account`'s "Documents" and "Conversions" lists.

If something doesn't work, check the terminal running `next dev` for a logged `AppError` — server-side failures are logged with `logAppError` (route + safe error code) even though the client only ever sees a safe, generic message.
