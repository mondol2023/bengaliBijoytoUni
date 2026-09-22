/**
 * Retention: how long a conversion-failure record is kept, expressed as an
 * `expireAt` field that Firestore's TTL service reads.
 *
 * ## The two halves, and why only one of them is code
 *
 * Writing `expireAt` deletes nothing. Firestore only expires documents in a
 * collection that has a **TTL policy** naming that field, and a TTL policy is
 * created once per collection from the console or `gcloud` — it cannot be
 * declared in this repo the way an index can (`firestore.indexes.json` has no
 * equivalent for TTL). So this module is inert until someone performs the
 * console step in `docs/data-retention.md`, which is deliberate: the field
 * can ship and be verified on real documents before anything is ever
 * deleted, and turning retention on is a decision with a date on it rather
 * than a side effect of a deploy.
 *
 * ## Why `expireAt` is a `Date` when every other timestamp here is a string
 *
 * The rest of this codebase stores timestamps as ISO strings
 * (`lib/firebase/schemas.ts`). TTL is the one place that cannot: the policy
 * only acts on a field of Firestore's `Timestamp` type, and a document whose
 * field is a string — or missing, or any other type — is simply never
 * expired, silently. The Admin SDK converts a JS `Date` to a `Timestamp` on
 * write, so a `Date` here is the string convention's exception, not a
 * departure from it.
 *
 * ## The two clocks
 *
 * An occurrence is a fixed-life record: it expires a fixed period after it
 * was written, and nothing extends it.
 *
 * A pattern is an aggregate that stays useful for as long as it is still
 * being seen, so its window slides — every new occurrence pushes `expireAt`
 * out again. A pattern therefore disappears only after a full retention
 * period with no occurrences at all, which is the condition that actually
 * means "nobody is hitting this any more".
 */
import { z } from "zod";

export const RETENTION_COLLECTIONS = ["conversionFailures", "failurePatterns"] as const;
export type RetentionCollection = (typeof RETENTION_COLLECTIONS)[number];

/**
 * **Proposed defaults, pending the maintainer's choice** — see
 * `docs/data-retention.md` for the alternatives considered and the trade-off
 * each one makes. Changing a number here changes only documents written
 * afterwards; existing documents keep the `expireAt` they were written with
 * until a backfill rewrites them.
 */
export const RETENTION_DAYS: Record<RetentionCollection, number> = {
  /** Individual occurrences: evidence for a mapping-rule fix, not a permanent record. */
  conversionFailures: 90,
  /** Aggregates, on a sliding window: kept while still being seen. */
  failurePatterns: 365,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant a document written now should stop being kept.
 *
 * Pure and clock-injectable so the periods are testable without waiting or
 * faking timers — the arithmetic is the whole of the policy.
 */
export function computeExpireAt(collection: RetentionCollection, now: Date = new Date()): Date {
  return new Date(now.getTime() + RETENTION_DAYS[collection] * DAY_MS);
}

/**
 * Validated at the write boundary like every other field, but kept out of
 * the read schemas on purpose: zod strips unknown keys, so `expireAt` never
 * reaches an API response, and no read path has to know that the Admin SDK
 * hands back a `Timestamp` where a `Date` went in.
 */
export const retentionFieldsSchema = z.object({ expireAt: z.date() });
export type RetentionFields = z.infer<typeof retentionFieldsSchema>;

/** The retention fields to merge into a document being written now. */
export function retentionFields(collection: RetentionCollection, now: Date = new Date()): RetentionFields {
  return retentionFieldsSchema.parse({ expireAt: computeExpireAt(collection, now) });
}

/**
 * Collections that hold conversion-failure data and are deliberately outside
 * retention, with the reason. Named rather than merely absent, because
 * "there is no TTL on this" and "nobody has got round to a TTL on this" look
 * identical from the outside, and only one of them is a decision.
 */
export const RETENTION_EXEMPT_COLLECTIONS = {
  aiResolutions:
    "An accepted resolution is a human decision about how a legacy sequence converts, " +
    "not a record of somebody's text. Expiring it would delete the review and leave the " +
    "pattern it resolved — the opposite of the trade the other two periods make.",
} as const;

/**
 * Whether one stored resolution could ever be expired, if `aiResolutions`
 * were given a TTL.
 *
 * **There is no such TTL today**, and
 * `__tests__/retentionInterplay.test.ts` fails if one appears without this
 * being honoured: `aiResolutions` is absent from `RETENTION_COLLECTIONS`,
 * nothing writes `expireAt` into it, and `aiResolutionSchema` has no such
 * field, so zod strips one even if a caller passes it. This function exists
 * so the rule that would then apply is written down as code next to the
 * periods, instead of being rediscovered by whoever adds the policy.
 *
 * Accepted is the exempt case, and only accepted. An unreviewed candidate is
 * a model's guess with a cost attached and nothing else; a rejected one is a
 * record of a mistake. Neither is a judgement worth keeping forever.
 */
export function mayExpireResolution(resolution: {
  reviewDecision: "accepted" | "rejected" | null;
}): boolean {
  return resolution.reviewDecision !== "accepted";
}
