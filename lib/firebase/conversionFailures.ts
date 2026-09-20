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
import { logAppError } from "@/lib/errors/handlers";

const FAILURES_COLLECTION = "conversionFailures";
const PATTERNS_COLLECTION = "failurePatterns";
const AI_RESOLUTIONS_COLLECTION = "aiResolutions";

/** How many recent occurrence IDs a pattern keeps for admin preview without a second query. */
const MAX_SAMPLE_OCCURRENCE_IDS = 5;

export type WithId<T> = T & { id: string };

export type ConversionFailureInput = Omit<
  ConversionFailure,
  "createdAt" | "patternId" | "codePoints" | "fullTextTruncated"
>;

function truncateFullText(fullText: string): { fullText: string; fullTextTruncated: boolean } {
  if (fullText.length <= CONVERSION_FAILURE_LIMITS.maxFullTextLength) {
    return { fullText, fullTextTruncated: false };
  }
  return {
    fullText: fullText.slice(0, CONVERSION_FAILURE_LIMITS.maxFullTextLength),
    fullTextTruncated: true,
  };
}

/** Computed, never invented — the exact code points of the exact failed sequence. */
export function codePointsOf(sequence: string): number[] {
  return Array.from(sequence)
    .map((char) => char.codePointAt(0))
    .filter((point): point is number => point !== undefined);
}

/**
 * Persists one occurrence and upserts its `failurePatterns` aggregate in a
 * single transaction, so `occurrenceCount` can never drift from the number of
 * occurrence documents that actually reference the pattern. The pattern's doc
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
  const { fullText, fullTextTruncated } = truncateFullText(input.fullText);
  const now = new Date().toISOString();

  const occurrenceRef = db.collection(FAILURES_COLLECTION).doc();
  const patternRef = db.collection(PATTERNS_COLLECTION).doc(patternId);

  const occurrence: ConversionFailure = {
    ...input,
    fullText,
    fullTextTruncated,
    codePoints: codePointsOf(input.failedSequence),
    patternId,
    createdAt: now,
  };
  const validatedOccurrence = conversionFailureSchema.parse(occurrence);

  await db.runTransaction(async (tx) => {
    const patternSnap = await tx.get(patternRef);

    if (!patternSnap.exists) {
      const pattern: FailurePattern = {
        encodingId: input.encodingId,
        engineVersion: input.engineVersion,
        failedSequence: input.failedSequence,
        failureCategory: input.failureCategory,
        occurrenceCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        sampleOccurrenceIds: [occurrenceRef.id],
        status: "open",
      };
      tx.set(patternRef, failurePatternSchema.parse(pattern));
    } else {
      const existing = patternSnap.data() as FailurePattern;
      const sampleOccurrenceIds = [...(existing.sampleOccurrenceIds ?? []), occurrenceRef.id].slice(
        -MAX_SAMPLE_OCCURRENCE_IDS,
      );
      tx.update(patternRef, {
        occurrenceCount: FieldValue.increment(1),
        lastSeenAt: now,
        sampleOccurrenceIds,
      });
    }

    tx.set(occurrenceRef, validatedOccurrence);
  });

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

export interface ListFailurePatternsOptions {
  limit: number;
  encodingId?: string;
  failureCategory?: FailurePattern["failureCategory"];
  status?: FailurePattern["status"];
}

/**
 * Most-recently-active-first listing. Every filter combination used here is
 * backed by a composite index in `firestore.indexes.json`.
 */
export async function listFailurePatterns(
  options: ListFailurePatternsOptions,
): Promise<WithId<FailurePattern>[]> {
  let query = getAdminDb().collection(PATTERNS_COLLECTION) as FirebaseFirestore.Query;
  if (options.encodingId) query = query.where("encodingId", "==", options.encodingId);
  if (options.failureCategory) query = query.where("failureCategory", "==", options.failureCategory);
  if (options.status) query = query.where("status", "==", options.status);

  const snapshot = await query.orderBy("lastSeenAt", "desc").limit(options.limit).get();
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
