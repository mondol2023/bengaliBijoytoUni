/**
 * Denormalized site-wide counters for the admin overview. Every function
 * here is called as a best-effort side effect of a primary write (a
 * conversion/comparison/document being recorded, a user being created or
 * changing tier) — never on its own. Call sites wrap these in a try/catch
 * that logs and swallows, matching the existing "persistence is a side
 * effect of the feature, not the feature itself" pattern in
 * `recordActivity.ts` — a stats-counter hiccup must never fail the request
 * that triggered it.
 *
 * Two documents hold everything:
 *  - `adminStats/totals` — one running total, read directly (no query).
 *  - `adminStatsDaily/{yyyy-mm-dd}` — one doc per UTC day, for the
 *    volume-over-time charts. Doc IDs sort lexicographically the same as
 *    chronologically, so `getAdminOverview` can page the last N days with
 *    an unindexed `orderBy(FieldPath.documentId())` query.
 */
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./admin";
import { adminStatsDailySchema, adminStatsTotalsSchema, type AdminStatsDaily, type AdminStatsTotals } from "./schemas";
import type { SupportedFileFormat, TierId } from "@/types/domain";

const TOTALS_REF = () => getAdminDb().collection("adminStats").doc("totals");
const DAILY_REF = (date: string) => getAdminDb().collection("adminStatsDaily").doc(date);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function bumpDaily(fields: Partial<Record<keyof Omit<AdminStatsDaily, "date">, number>>): Promise<void> {
  const date = todayUtc();
  const increments: Record<string, unknown> = { date };
  for (const [key, amount] of Object.entries(fields)) {
    if (amount) increments[key] = FieldValue.increment(amount);
  }
  await DAILY_REF(date).set(increments, { merge: true });
}

export async function recordConversionStats(encodingId: string, status: "success" | "error", charCount: number) {
  await Promise.all([
    TOTALS_REF().set(
      {
        totalConversions: FieldValue.increment(1),
        totalCharsProcessed: FieldValue.increment(charCount),
        [`conversionsByStatus.${status}`]: FieldValue.increment(1),
        [`conversionsByEncoding.${encodingId}`]: FieldValue.increment(1),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    ),
    bumpDaily({ conversions: 1, charsProcessed: charCount, conversionErrors: status === "error" ? 1 : 0 }),
  ]);
}

export async function recordComparisonStats(mode: "word" | "paragraph") {
  await Promise.all([
    TOTALS_REF().set(
      {
        totalComparisons: FieldValue.increment(1),
        [`comparisonsByMode.${mode}`]: FieldValue.increment(1),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    ),
    bumpDaily({ comparisons: 1 }),
  ]);
}

export async function recordDocumentStats(fileType: SupportedFileFormat, status: "success" | "error") {
  await Promise.all([
    TOTALS_REF().set(
      {
        totalDocuments: FieldValue.increment(1),
        [`documentsByStatus.${status}`]: FieldValue.increment(1),
        [`documentsByFormat.${fileType}`]: FieldValue.increment(1),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    ),
    bumpDaily({ documents: 1, documentErrors: status === "error" ? 1 : 0 }),
  ]);
}

/** Called when a `users/{uid}` profile document is created for the first time. */
export async function recordUserCreated(tier: TierId) {
  await TOTALS_REF().set(
    {
      totalUsers: FieldValue.increment(1),
      [`usersByTier.${tier}`]: FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/** Called when an existing user's tier changes — keeps `usersByTier` accurate without a full user scan. */
export async function recordUserTierChange(oldTier: TierId, newTier: TierId) {
  if (oldTier === newTier) return;
  await TOTALS_REF().set(
    {
      [`usersByTier.${oldTier}`]: FieldValue.increment(-1),
      [`usersByTier.${newTier}`]: FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

const EMPTY_TOTALS: AdminStatsTotals = {
  totalUsers: 0,
  totalConversions: 0,
  totalComparisons: 0,
  totalDocuments: 0,
  totalCharsProcessed: 0,
  conversionsByStatus: { success: 0, error: 0 },
  documentsByStatus: { success: 0, error: 0 },
  comparisonsByMode: { word: 0, paragraph: 0 },
  documentsByFormat: { pdf: 0, docx: 0, doc: 0, txt: 0 },
  conversionsByEncoding: {},
  usersByTier: { easy: 0, medium: 0, expert: 0 },
  updatedAt: new Date(0).toISOString(),
};

export interface AdminOverview {
  totals: AdminStatsTotals;
  daily: AdminStatsDaily[];
}

const DAILY_HISTORY_DAYS = 30;

/** Reads the totals doc plus the most recent `DAILY_HISTORY_DAYS` daily docs — two reads and one bounded query, never a collection scan. */
export async function getAdminOverview(): Promise<AdminOverview> {
  const db = getAdminDb();
  const [totalsSnapshot, dailySnapshot] = await Promise.all([
    TOTALS_REF().get(),
    db.collection("adminStatsDaily").orderBy(FieldPath.documentId(), "desc").limit(DAILY_HISTORY_DAYS).get(),
  ]);

  const totalsParsed = totalsSnapshot.exists ? adminStatsTotalsSchema.safeParse(totalsSnapshot.data()) : null;
  const totals = totalsParsed?.success ? totalsParsed.data : EMPTY_TOTALS;

  const daily = dailySnapshot.docs
    .flatMap((doc) => {
      const parsed = adminStatsDailySchema.safeParse(doc.data());
      return parsed.success ? [parsed.data] : [];
    })
    .reverse(); // oldest → newest, for a left-to-right chart

  return { totals, daily };
}
