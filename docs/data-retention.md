# Data retention

How long conversion-failure records are kept, how expiry is turned on, and
which retention periods to pick.

**Status: the code half is in, the policy half is not.** New documents now
carry an `expireAt` field (`lib/conversionFailures/retention.ts`). Nothing is
deleted until someone creates the TTL policies in the Firebase console — step
3 below. That order is deliberate: the field can be verified on real
documents before anything is ever removed.

## 1. What Firestore TTL actually does

A TTL policy is defined per collection and names one field. Firestore deletes
a document some time after the instant in that field.

Four properties worth knowing before relying on it:

- **The field must be of type `Timestamp`.** A document whose field holds a
  string, or is missing the field entirely, is never expired — with no error
  and no warning. This is why `expireAt` is the one timestamp in this
  codebase written as a `Date` (the Admin SDK converts a `Date` to a
  `Timestamp`) rather than as the ISO string every other timestamp uses.
- **Deletion is not immediate.** Google documents it as typically within 24
  hours of the expiration time, and does not guarantee a bound. Retention of
  "90 days" therefore means "90 days, plus up to about a day".
- **Deletes are billed as deletes**, one document operation each, and they
  count against write throughput. The `failurePatterns` policy will delete
  very little; the `conversionFailures` one deletes roughly a retention
  period's worth of rows per period, spread out.
- **TTL is retroactive.** The moment a policy is enabled, every document
  already past its `expireAt` becomes eligible. Documents written before
  this change have no `expireAt` at all, so they are never expired — see §5.

## 2. What is stamped, and on what clock

| Collection | Clock | Set where |
| --- | --- | --- |
| `conversionFailures` | **Fixed.** Expires a retention period after it was written; nothing extends it. | `recordOne`, on the occurrence document |
| `failurePatterns` | **Sliding.** Every new occurrence pushes `expireAt` out again. | `recordOne`, on both the create and the update path |

The sliding window is the point of the split. A pattern is an aggregate whose
value is that it is still being hit; on a fixed clock a pattern reported
daily for two years would expire on the schedule of its first occurrence. On
a sliding clock it disappears only after a full retention period with no
occurrences at all, which is the condition that actually means nobody is
hitting it any more.

`aiResolutions` is not stamped. It holds admin review decisions and provider
responses about a *pattern*, contains no user document text, and is the audit
trail for a paid external call. Expiring it would discard the record of a
decision a human made. (If patterns expire while their resolutions do not,
some resolutions will reference a pattern that no longer exists. Nothing
dereferences `patternId` in that direction today.)

## 3. Turning it on (console step, once per collection)

Firestore TTL policies cannot be declared in this repo — there is no
equivalent of `firestore.indexes.json` for them.

1. Firebase console → **Firestore Database** → **TTL** tab
   (or: Google Cloud console → Firestore → Time-to-live).
2. **Create policy**. Collection group: `conversionFailures`. Timestamp
   field: `expireAt`. Create.
3. Repeat for collection group `failurePatterns`, same field name.
4. Each policy shows as *Creating* for a few minutes, then *Active*. The
   first deletion pass follows within about 24 hours.

Equivalent CLI, if you prefer it:

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=conversionFailures --enable-ttl --project=<projectId>
gcloud firestore fields ttls update expireAt \
  --collection-group=failurePatterns --enable-ttl --project=<projectId>
```

To verify before trusting it: open any `conversionFailures` document written
after this change and confirm `expireAt` renders as a timestamp, not as a
string. To turn it off, delete the policy — the `expireAt` fields stay, inert.

## 4. Choosing the periods

The defaults in `lib/conversionFailures/retention.ts` are **proposals**.
Change the two numbers there and the change applies to documents written
afterwards.

### `conversionFailures` (individual occurrences) — proposed **90 days**

These carry the only user content in the pipeline: the failed sequence and
its context window, up to the caps in `lib/conversionFailures/limits.ts`.
Their purpose is evidence for a mapping-rule fix.

| Option | For | Against |
| --- | --- | --- |
| 30 days | Smallest window of retained user content. Enough for the week-to-month loop of noticing a pattern and fixing the table. | A quarterly pass over the corpus finds the aggregates but not the samples behind them. Seasonal or rare documents may never be examined in time. |
| **90 days (proposed)** | Covers a realistic fix cycle including a quiet month. Long enough to compare a sequence before and after an engine-version change, which is how a regression is diagnosed. | Three months of context windows retained. |
| 180 days | Spans two engine versions comfortably; good for arguing a rule change against a year's worth of real usage. | Hard to justify as necessary for the stated purpose, which is the standard a privacy disclosure is read against. |

Recommendation: **90 days.** The aggregate — which is what the triage UI
actually ranks and the AI resolution actually reads — lives in
`failurePatterns` and survives far longer, so a short occurrence retention
costs the samples, not the intelligence.

### `failurePatterns` (aggregates) — proposed **365 days, sliding**

A pattern holds the failed sequence, counts and timestamps. No context
window, no document text.

| Option | For | Against |
| --- | --- | --- |
| 180 days sliding | Keeps the list to what is current. | A font that appears once a year (an annual report season) looks new every time; `firstSeenAt` and the accumulated `occurrenceCount` are lost. |
| **365 days sliding (proposed)** | An annual cycle appears as a recurrence rather than as a new pattern. A pattern goes away only after a year of total silence. | A year of rows for sequences that were fixed long ago — small, but they accumulate. |
| Never expire | The full history of what this engine has ever failed on is the most useful thing for deciding which encodings to support next. | Unbounded growth, and a "we keep it indefinitely" line in the disclosure. |

Recommendation: **365 days sliding.** Cheap, bounded, and it keeps the one
dataset that gets more valuable with age.

### Tell me which you want

Reply with a number for each and I will change the two constants and the
disclosure copy to match. Whatever you pick, the periods and the disclosure
text have to say the same thing.

## 5. Documents written before this change

They have no `expireAt`, so no policy will ever expire them. Two of them:

- **Content.** `scripts/redactLegacyFailures.mjs` clears `fullText` and
  `engineOutput` on old occurrence rows — the urgent half, and independent
  of retention.
- **The rows themselves.** They stay forever unless backfilled with an
  `expireAt`. This is not written yet; it is a variant of the remediation
  script, and worth doing in the same pass once the periods are chosen.
  Backfilling with `createdAt + retention` rather than `now + retention`
  makes old rows expire on the same schedule they would have had.

## 5a. `aiResolutions` is exempt, deliberately

The third collection in the pipeline has **no retention and no `expireAt`**,
and that is a decision rather than an omission. An accepted resolution is a
human judgement about how a legacy sequence converts. Expiring it would
delete the review while leaving the pattern it resolved standing — the
opposite of the trade the other two periods make, where the aggregate
outlives the individual records that fed it.

Four things keep it true, each asserted in
`lib/conversionFailures/__tests__/retentionInterplay.test.ts`:

1. `aiResolutions` is absent from `RETENTION_COLLECTIONS`, in
   `lib/conversionFailures/retention.ts` and in `scripts/retentionPeriods.mjs`,
   so neither the app nor the backfill script can stamp it.
2. `aiResolutionSchema` declares no `expireAt`. Every write to the collection
   goes through `aiResolutionSchema.parse`, and zod strips unknown keys, so a
   caller passing one has it dropped rather than persisted.
3. No shipped module writes the field into that collection; the only
   `retentionFields()` call sites name the other two.
4. `mayExpireResolution` in `retention.ts` states the rule that would apply
   if a TTL were ever added: accepted is exempt, unreviewed and rejected are
   not. It has no caller today, and the test above is what would fail if a
   policy appeared without honouring it.

`RETENTION_EXEMPT_COLLECTIONS` in the same module carries the reason in code,
because "there is no TTL here" and "nobody got round to a TTL here" look
identical from outside and only one of them is a choice.

Note that this exemption is about the *resolution*, not about the occurrence
it came from. The user text that produced the failure still lives in
`conversionFailures` and still expires at 90 days; what survives is the
sequence, the candidate conversion, and who accepted it.

## 6. Uploaded files

Everything above is about the two failure collections. Uploaded files are a
separate and larger exposure: `recordDocumentUpload` saves the original file
to Storage at `users/{uid}/documents/{docId}/{filename}` and writes a
`documents/{docId}` metadata record, both for signed-in users only, and
neither has ever expired.

### What now exists: a per-file delete

`DELETE /api/documents/[documentId]` removes both halves, exposed on each row
of the Documents list on `/account`. `lib/firebase/deleteDocumentUpload.ts`
owns the semantics; the part worth knowing outside that file is that **there
is no transaction across Storage and Firestore**, so the order is the design:

- Storage first. If it fails, nothing else is attempted and both halves
  remain — the row is still in the history and the delete can be retried.
- Firestore second. If it fails after the file is gone, the user is told
  exactly that, and a retry works because the Storage delete passes
  `ignoreNotFound`.

The reverse order would allow the one state worth engineering against: the
user's file still in the bucket with no record of it, invisible in the UI and
no longer deletable by the person who uploaded it.

`usage/{uid}` counters are not decremented. They are lifetime totals of
activity, not an inventory of retained files.

### Not built: account-deletion cascade — a proposal

Deleting one file at a time is not the same as leaving. There is no
account-deletion path in this codebase at all today (no `deleteUser` call
anywhere, and `/api/admin/users/[uid]` exposes only `PATCH`), so this is a
new feature rather than an extension, and it is not started.

What a cascade would have to cover, read off the collections that carry a
`userId`:

| Data | Path | Proposed action |
| --- | --- | --- |
| Uploaded files | `users/{uid}/documents/**` in Storage | Delete the prefix. |
| Document metadata | `documents` where `userId == uid` | Delete. |
| Conversion history | `conversions` where `userId == uid` | Delete. |
| Comparison history | `comparisons` where `userId == uid` | Delete. |
| Usage counters | `usage/{uid}` | Delete. |
| Profile | `users/{uid}` | Delete. |
| Auth user | Firebase Auth | `getAdminAuth().deleteUser(uid)` — **last**, because it is the one step that cannot be retried under the same identity. |
| Failure occurrences | `conversionFailures` where `userId == uid` | **Anonymize, not delete** — see below. |
| Error log rows | `errorLogs` where `userId == uid` | Anonymize, same reasoning. |
| Feedback | `feedback` where `userId == uid` | Anonymize; an admin may be mid-triage on it. |
| Aggregates | `failurePatterns`, admin stats counters | Untouched. They hold no user field and cannot be attributed back. |

Four things that need deciding before any of it is written, and none of them
are technical:

1. **Anonymize or delete the diagnostics.** A `conversionFailures` row holds
   a failed sequence and an 80-character window — real content, but the only
   evidence behind a mapping fix, and it is already on a 90-day clock.
   Setting `userId: null` makes it exactly what an anonymous visitor's report
   would have been. Deleting it is the stronger promise and loses the
   evidence. I lean anonymize, and would say so in the disclosure.
2. **Ordering and partial failure, at a much larger scale.** The same
   two-store problem as a single file, across hundreds of documents and
   several collections. It needs to be resumable: a durable "deletion
   requested" marker that hides the account immediately, with the sweep as a
   separate job that can be re-run, rather than one long request that can die
   halfway and leave no record of how far it got.
3. **Who can trigger it.** The user themselves (re-authentication required —
   Firebase Auth demands a recent login for `deleteUser`), an admin, or both.
4. **Whether it is immediate or delayed.** A grace period makes accidental
   and coerced deletions recoverable; immediate deletion is the simpler
   promise to keep.

Cost is a day or two of work, most of it in the resumability. It should not
be bolted onto the per-file delete — that one is small, synchronous and
user-initiated, and a cascade is none of those things.

### Also not built: a bucket lifecycle rule

Storage has no expiry at all. A lifecycle rule on the bucket would give
uploaded files the same kind of bound the failure collections now have.
Deliberately **not** added — it deletes a user-visible feature (their
document history) on a timer, which is a product decision, not a privacy
cleanup.
