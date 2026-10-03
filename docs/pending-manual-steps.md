# Pending manual steps

Everything that needs the maintainer, the Firebase console or a real
credential, gathered from Phases 3–5 into one list. Nothing here can be done
from a test run, and nothing here has been done.

Tracking only — no step below is a task for the implementation agent, and
none of them runs against the live project without being started by hand.

## 1. Retention, in this order

Order matters: the backfill stamps `expireAt` on legacy rows, and a row that
still holds document text should be redacted *before* it is given an expiry,
not after — otherwise the text sits there for the whole retention period.

1. **Redact legacy rows.** `node scripts/redactLegacyFailures.mjs` (added in
   `dc94901`, written and never run).
2. **Backfill `expireAt`.** `node scripts/backfillRetention.mjs` (added in
   `d6c3241`, written and never run).

Both are dry runs without `--apply`: run them bare first and read the counts.
3. **Create the TTL policies** in the Firebase console, on `expireAt`, for
   **both** `conversionFailures` and `failurePatterns`. A TTL policy is
   console-only; nothing in this repo can create one. Periods and the
   reasoning: `docs/data-retention.md`.
4. **Create TTL policies for the shared counters**, on `expireAt`, for
   `rateLimitWindows` and `aiCallBudget` (added in `8d956b9` and
   `e370f93`). These need no redaction or backfill, because every counter
   document is written with its `expireAt` already set: the end of its
   rate-limit window, or 35 days after its budget day. Without the policies
   nothing breaks, but a window document per caller per window accumulates
   and is never deleted.

`aiResolutions` is deliberately **not** in this list — see §5 below.

## 2. Indexes

Deploy the composite indexes, including the `aiResolutions` one added in
Phase 4:

```
firebase deploy --only firestore:indexes
```

Until this runs, the queries that need them fail at runtime with an index
error rather than degrading.

## 3. Copy to review and approve — one review, all three items

- The privacy disclosure copy (Phase 3, `docs/privacy-disclosure-proposal.md`).
- `AI_UNVERIFIED_LABEL`, English and Bengali
  (`lib/conversionFailures/knownResolutions.ts`).
- `FALLBACK_ACCEPTED_LABEL`, English and Bengali (Phase 6, same file). Held
  as `TBD_ACCEPTED_LABEL`, the same `TBD`-marked draft shape. It has no flag
  of its own — an accepted fallback is shown whenever fallbacks are — so the
  gate on it is `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE`, off by default. That
  flag must not be turned on until this copy is approved.

The label currently ships as `TBD_LABEL`, a marked placeholder. That is not a
release blocker: `fallback_unverified` is gated behind `SERVE_UNVERIFIED_AI`,
which is off by default, so no user sees the placeholder until both the flag
and the copy are approved. Swapping the real copy in is a one-constant
change.

## 4. Golden corpus

Supply real SutonnyMJ sample documents for the runner added in `6b6e33c`. It
skips cleanly while the corpus directory is empty, so the suite stays green
and the coverage stays absent — which is the point of listing it here.

## 5. Deployment topology — answered and closed

**Answered 2026-10-04: Vercel, serverless, potentially multiple concurrent
instances.** As this item said it would, that moved the cost cap and the
rate limiter to a shared atomic counter: a Firestore document per counter,
reserved in a transaction with `FieldValue.increment` (`e370f93`,
`8d956b9`). Threat-model findings 3 and 4 are closed on that basis
(`516493a`, and that document's §3 and §4).

What is left for the maintainer, and none of it blocks code:

- The two counter TTL policies, item 1.4 above.
- Leave **"Enable access to System Environment Variables"** on in the Vercel
  project (it is what sets `VERCEL=1`). If it is off, the client IP is
  still read correctly from `x-forwarded-for`, which Vercel overwrites, but
  a proxy placed in front of Vercel would then go unnoticed.

## 6. Backlog, not a task

- **Orphaned v1 `aiResolutions` rows.** Left in place, no migration. The
  whole collection is exempt from retention
  (`RETENTION_EXEMPT_COLLECTIONS`), so *every* v1 row is excluded, not only
  the accepted ones, and none of them will clean up on their own. If the
  collection ever grows large enough to matter, write a cleanup script then,
  against real size data.
- **An admin-side count of reports per resolution**, so the review queue can
  be sorted by "accepted, and people are complaining". A field and a query;
  it does not change who decides.
