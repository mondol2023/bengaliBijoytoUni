/**
 * Server-only writer + reader for the conversion-failure intelligence
 * pipeline's `conversionFailures`/`failurePatterns` collections. See
 * `docs/conversion-failure-pipeline.md` for the full design.
 *
 * Two things feed `recordConversionFailures`: the browser (via
 * `/api/conversion-failures`, for failures in the client-side text-converter
 * pipeline) and server routes (via `captureConversionFailures`, for
 * `/api/documents/extract`). Every occurrence is retained — never merged,
 * never deduplicated away — while `failurePatterns` is the aggregate that
 * makes cost-controlled AI resolution and admin triage practical.
 *
 * Like `errorLog.ts`, a failed write here must never fail the request that
 * triggered it: `captureConversionFailures` logs and swallows.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./admin";
import {
  conversionFailureSchema,
  failurePatternSchema,
  aiResolutionSchema,
  type ConversionFailure,
  type FailurePattern,
  type AiResolution,
} from "./schemas";
import { computeFailurePatternId } from "@/lib/conversionFailures/patternId";
import { CONVERSION_FAILURE_LIMITS } from "@/lib/conversionFailures/limits";
import { retentionFields } from "@/lib/conversionFailures/retention";
import { countWrites, type WriteOperation } from "./writeMetrics";
import { logAppError } from "@/lib/errors/handlers";

const FAILURES_COLLECTION = "conversionFailures";
const PATTERNS_COLLECTION = "failurePatterns";
const AI_RESOLUTIONS_COLLECTION = "aiResolutions";

/** How many recent occurrence IDs a pattern keeps for admin preview without a second query. */
const MAX_SAMPLE_OCCURRENCE_IDS = 5;

export type WithId<T> = T & { id: string };

/**
 * `fullText`/`fullTextTruncated` are absent by construction: callers cannot
 * supply the user's whole document any more, because nothing collects it (see
 * `lib/conversionFailures/occurrence.ts`). The two fields remain in
 * `conversionFailureSchema` so occurrences written before this bound existed
 * still parse on read; new documents always get the empty values written in
 * `recordOne`.
 */
export type ConversionFailureInput = Omit<
  ConversionFailure,
  "createdAt" | "patternId" | "codePoints" | "fullText" | "fullTextTruncated" | "occurrenceCount"
> & {
  /**
   * How many occurrences this entry stands for. Omitted means one, which is
   * what every caller written before batching meant.
   */
  occurrenceCount?: number;
};

/** Computed, never invented — the exact code points of the exact failed sequence. */
export function codePointsOf(sequence: string): number[] {
  return Array.from(sequence)
    .map((char) => char.codePointAt(0))
    .filter((point): point is number => point !== undefined);
}

/**
 * Persists one occurrence document and upserts its `failurePatterns`
 * aggregate in a single transaction, so the aggregate can never drift from
 * the occurrences that were actually accepted.
 *
 * Note the unit. Since reports are batched
 * (`lib/conversionFailures/reportBuffer.ts`), a document stands for
 * `occurrenceCount` occurrences and the pattern is incremented by that
 * number — so `occurrenceCount` counts occurrences while the document count
 * counts batches. Before batching the two were equal, and the earlier
 * wording here promised they always would be; keeping that promise would
 * have meant either writing one document per occurrence or leaving the
 * aggregate counting sessions instead of occurrences. The pattern's doc
 * ID is a deterministic content hash (`computeFailurePatternId`), not a
 * read-then-write lookup, so concurrent occurrences of the same failure never
 * race into two pattern documents — Firestore's transaction retry handles
 * the case where two occurrences in the same batch hit the same new pattern.
 */
async function recordOne(input: ConversionFailureInput): Promise<string> {
  const db = getAdminDb();
  const patternId = computeFailurePatternId({
    encodingId: input.encodingId,
    engineVersion: input.engineVersion,
    failedSequence: input.failedSequence,
  });
  const nowDate = new Date();
  const now = nowDate.toISOString();

  const occurrenceRef = db.collection(FAILURES_COLLECTION).doc();
  const patternRef = db.collection(PATTERNS_COLLECTION).doc(patternId);

  // Clamped rather than trusted: this number now moves an aggregate by more
  // than one, and the caller is ultimately an anonymous browser.
  const occurrenceCount = Math.min(
    Math.max(1, Math.floor(input.occurrenceCount ?? 1)),
    CONVERSION_FAILURE_LIMITS.maxOccurrenceCount,
  );

  const occurrence: ConversionFailure = {
    ...input,
    occurrenceCount,
    fullText: "",
    fullTextTruncated: false,
    codePoints: codePointsOf(input.failedSequence),
    patternId,
    createdAt: now,
  };
  const validatedOccurrence = conversionFailureSchema.parse(occurrence);

  // Counted around the transaction rather than inside it: Firestore retries
  // a contended transaction, and counting per attempt would report retries
  // as traffic. What a capacity question needs is writes committed per
  // logical report, which is what one pass of this block is.
  let patternOperation: WriteOperation = "update";

  await db.runTransaction(async (tx) => {
    const patternSnap = await tx.get(patternRef);

    if (!patternSnap.exists) {
      patternOperation = "create";
      const pattern: FailurePattern = {
        encodingId: input.encodingId,
        engineVersion: input.engineVersion,
        failedSequence: input.failedSequence,
        failureCategory: input.failureCategory,
        occurrenceCount,
        firstSeenAt: now,
        lastSeenAt: now,
        sampleOccurrenceIds: [occurrenceRef.id],
        status: "open",
      };
      tx.set(patternRef, {
        ...failurePatternSchema.parse(pattern),
        ...retentionFields("failurePatterns", nowDate),
      });
    } else {
      const existing = patternSnap.data() as FailurePattern;
      const sampleOccurrenceIds = [...(existing.sampleOccurrenceIds ?? []), occurrenceRef.id].slice(
        -MAX_SAMPLE_OCCURRENCE_IDS,
      );
      tx.update(patternRef, {
        occurrenceCount: FieldValue.increment(occurrenceCount),
        lastSeenAt: now,
        sampleOccurrenceIds,
        // Sliding window: a pattern still being hit must not expire out from
        // under the occurrences that keep arriving for it.
        ...retentionFields("failurePatterns", nowDate),
      });
    }

    tx.set(occurrenceRef, {
      ...validatedOccurrence,
      ...retentionFields("conversionFailures", nowDate),
    });
  });

  // Two document writes per accepted report, whatever the occurrence count
  // it carries — which is the number the batching change is meant to hold
  // down and the number the caching question turns on.
  countWrites([
    { collection: FAILURES_COLLECTION, operation: "create" },
    { collection: PATTERNS_COLLECTION, operation: patternOperation },
  ]);

  return occurrenceRef.id;
}

/** Persists every occurrence from one conversion attempt. Throws on the first Firestore failure. */
export async function recordConversionFailures(items: ConversionFailureInput[]): Promise<string[]> {
  return Promise.all(items.map(recordOne));
}

/**
 * Best-effort capture, mirroring `errorLog.ts`'s `captureServerIssue` — never
 * throws. Call it alongside the primary response path and let the real
 * request succeed or fail independently of whether logging did.
 */
export async function captureConversionFailures(
  items: ConversionFailureInput[],
  route: string | null,
): Promise<void> {
  if (items.length === 0) return;
  try {
    await recordConversionFailures(items);
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to record conversion failure(s).", debug: cause },
      { route: route ?? "unknown" },
    );
  }
}

/**
 * `lastSeenAt` answers "what is happening now", `occurrenceCount` answers
 * "what is worth fixing" — a pattern seen thirty seconds ago once outranks a
 * pattern seen this morning nine hundred times under the first and is
 * outranked under the second. Both are legitimate; neither is a default that
 * serves the other's question.
 */
export type FailurePatternOrder = "lastSeenAt" | "occurrenceCount";

export interface ListFailurePatternsOptions {
  limit: number;
  encodingId?: string;
  failureCategory?: FailurePattern["failureCategory"];
  status?: FailurePattern["status"];
  /** Defaults to `lastSeenAt`, preserving the behavior every existing caller relies on. */
  orderBy?: FailurePatternOrder;
}

/**
 * Descending by whichever field `orderBy` names. Every filter/order
 * combination used here is backed by a composite index in
 * `firestore.indexes.json` — an unindexed combination fails at query time
 * with a `FAILED_PRECONDITION`, not silently, so adding a filter means adding
 * the matching index in the same commit.
 */
export async function listFailurePatterns(
  options: ListFailurePatternsOptions,
): Promise<WithId<FailurePattern>[]> {
  let query = getAdminDb().collection(PATTERNS_COLLECTION) as FirebaseFirestore.Query;
  if (options.encodingId) query = query.where("encodingId", "==", options.encodingId);
  if (options.failureCategory) query = query.where("failureCategory", "==", options.failureCategory);
  if (options.status) query = query.where("status", "==", options.status);

  const snapshot = await query
    .orderBy(options.orderBy ?? "lastSeenAt", "desc")
    .limit(options.limit)
    .get();
  return snapshot.docs.flatMap((doc) => {
    const parsed = failurePatternSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });
}

const RECENT_OCCURRENCES_LIMIT = 20;

export interface FailurePatternDetail {
  pattern: WithId<FailurePattern>;
  occurrences: WithId<ConversionFailure>[];
}

/**
 * Just the pattern document, no occurrences — for callers that only need to
 * confirm a pattern exists or read its aggregate fields (e.g. review's
 * pattern-existence check), not its up-to-20-occurrence, full-text-bearing
 * detail. Prefer this over `getFailurePatternDetail` whenever occurrence data
 * isn't actually used.
 */
export async function getFailurePatternById(patternId: string): Promise<WithId<FailurePattern> | null> {
  const patternSnap = await getAdminDb().collection(PATTERNS_COLLECTION).doc(patternId).get();
  if (!patternSnap.exists) return null;
  const parsed = failurePatternSchema.safeParse(patternSnap.data());
  return parsed.success ? { id: patternSnap.id, ...parsed.data } : null;
}

/** One pattern plus its most recent occurrences — the admin detail page's single data source. */
export async function getFailurePatternDetail(patternId: string): Promise<FailurePatternDetail | null> {
  const db = getAdminDb();
  const patternSnap = await db.collection(PATTERNS_COLLECTION).doc(patternId).get();
  if (!patternSnap.exists) return null;
  const parsedPattern = failurePatternSchema.safeParse(patternSnap.data());
  if (!parsedPattern.success) return null;

  const occurrencesSnap = await db
    .collection(FAILURES_COLLECTION)
    .where("patternId", "==", patternId)
    .orderBy("createdAt", "desc")
    .limit(RECENT_OCCURRENCES_LIMIT)
    .get();

  const occurrences = occurrencesSnap.docs.flatMap((doc) => {
    const parsed = conversionFailureSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });

  return { pattern: { id: patternSnap.id, ...parsedPattern.data }, occurrences };
}

/**
 * Every AI resolution attempt recorded against one pattern, newest first —
 * the admin detail page's resolution history. Backed by the same
 * `patternId` ASC / `createdAt` DESC composite index as the occurrence query
 * above (`firestore.indexes.json`).
 */
export async function listAiResolutionsForPattern(patternId: string): Promise<WithId<AiResolution>[]> {
  const snapshot = await getAdminDb()
    .collection(AI_RESOLUTIONS_COLLECTION)
    .where("patternId", "==", patternId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.flatMap((doc) => {
    const parsed = aiResolutionSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });
}

export interface FailurePatternSummary {
  totalPatterns: number;
  totalOccurrences: number;
  byCategory: Record<string, number>;
  openCount: number;
  resolvedCount: number;
}

/**
 * Derived from the rows already fetched, not a second aggregate query —
 * matches `errorLog.ts#summarizeErrorLogs`'s reasoning: the admin list shows
 * a capped window and the summary describes exactly that window.
 */
export function summarizeFailurePatterns(patterns: FailurePattern[]): FailurePatternSummary {
  const byCategory: Record<string, number> = {};
  let totalOccurrences = 0;
  let openCount = 0;
  let resolvedCount = 0;

  for (const pattern of patterns) {
    byCategory[pattern.failureCategory] = (byCategory[pattern.failureCategory] ?? 0) + pattern.occurrenceCount;
    totalOccurrences += pattern.occurrenceCount;
    if (pattern.status === "open") openCount += 1;
    else resolvedCount += 1;
  }

  return { totalPatterns: patterns.length, totalOccurrences, byCategory, openCount, resolvedCount };
}

/**
 * Applies a batch of accumulated resolution hits
 * (`lib/conversionFailures/resolutionHits.ts`) as one atomic increment per
 * document.
 *
 * `update`, not `set` with a merge: a hit on a document that has since been
 * deleted should fail that one write rather than resurrect the record as a
 * stub with nothing but a count on it. The whole batch is one commit, so a
 * missing document fails the batch — which the counter reports and drops,
 * matching its stated "ranking may be slightly stale" trade.
 */
export async function applyResolutionHits(
  pending: readonly { resolutionId: string; hits: number; lastUsedAt: string }[],
): Promise<void> {
  if (pending.length === 0) return;
  const db = getAdminDb();
  const batch = db.batch();
  for (const entry of pending) {
    const ref = db.collection(AI_RESOLUTIONS_COLLECTION).doc(entry.resolutionId);
    batch.update(ref, {
      hitCount: FieldValue.increment(entry.hits),
      lastUsedAt: entry.lastUsedAt,
    });
  }
  await batch.commit();
  // One document write per entry, whatever the coalesced hit count — the
  // batching is exactly what keeps this number below the number of served
  // results.
  countWrites([
    { collection: AI_RESOLUTIONS_COLLECTION, operation: "update", documents: pending.length },
  ]);
}

/**
 * Candidate resolutions for one encoding, most-used first — the read behind
 * the published snapshot's `resolutions` array.
 *
 * Deliberately *not* filtered to `reviewDecision == "accepted"` in the
 * query. Firestore would need a third indexed field for that, and the
 * decision about what may be published is one the pure selector owns
 * (`lib/conversionFailures/knownResolutions.ts`), where it can be read and
 * tested without a database. What the query does is bound the read: one
 * encoding, ordered by `hitCount`, a hard limit. Over-fetching a little and
 * filtering in memory is the cheaper mistake here — the alternative is a
 * publication rule split across an index definition and a function.
 *
 * Backed by the `encodingId` ASC / `hitCount` DESC composite index in
 * `firestore.indexes.json`.
 */
export async function listResolutionsForEncoding(options: {
  encodingId: string;
  limit: number;
}): Promise<WithId<AiResolution>[]> {
  const snapshot = await getAdminDb()
    .collection(AI_RESOLUTIONS_COLLECTION)
    .where("encodingId", "==", options.encodingId)
    .orderBy("hitCount", "desc")
    .limit(options.limit)
    .get();

  return snapshot.docs.flatMap((doc) => {
    const parsed = aiResolutionSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });
}
