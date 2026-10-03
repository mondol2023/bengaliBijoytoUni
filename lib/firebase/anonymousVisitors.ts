/**
 * Server-only. Turns a signed-out browser's random visitor id
 * (`lib/conversionFailures/anonymousVisitor.ts`) into a stable, sequential
 * `anonymousN` label for the conversion-failure pipeline.
 *
 * ## Storage
 *
 * `anonymousVisitors/{sha256(visitorId)}` → `{ number, label, createdAt }`,
 * and one counter document, `anonymousVisitorCounter/sequence` →
 * `{ lastNumber }`. The raw id is never written: the hash is enough to
 * recognise a returning browser, and a database reader cannot recover an id
 * to impersonate it with.
 *
 * ## Numbering across instances
 *
 * The deployment runs many serverless instances, so "next number" is decided
 * in a Firestore transaction that reads both the visitor and the counter. Two
 * first sightings racing each other contend on the counter and one re-runs;
 * two reports from the same new visitor contend on the visitor document and
 * the loser finds it already created. Neither can produce a duplicate.
 *
 * A returning visitor costs one plain read and no transaction. A new one
 * costs two writes; the route's rate limit bounds how many a caller can mint.
 *
 * Neither collection has a TTL. Expiring a visitor would only hand a
 * returning browser a fresh number, and expiring the counter would reuse
 * numbers — so there is nothing to gain, and the documents carry nothing
 * but a hash and an integer.
 */
import { createHash } from "crypto";
import { getAdminDb } from "./admin";
import { anonymousVisitorSchema, type AnonymousVisitor } from "./schemas";
import { countWrites } from "./writeMetrics";

const VISITORS_COLLECTION = "anonymousVisitors";
const COUNTER_COLLECTION = "anonymousVisitorCounter";
const COUNTER_DOC = "sequence";

export function anonymousVisitorKey(visitorId: string): string {
  return createHash("sha256").update(`anonymous-visitor|${visitorId}`, "utf8").digest("hex");
}

export function anonymousLabelFor(number: number): string {
  return `anonymous${number}`;
}

function lastNumberOf(data: unknown): number {
  if (typeof data !== "object" || data === null) return 0;
  const value = (data as { lastNumber?: unknown }).lastNumber;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/** Returns the visitor's label, assigning the next number on first sight. */
export async function resolveAnonymousLabel(visitorId: string): Promise<string> {
  const db = getAdminDb();
  const visitorRef = db.collection(VISITORS_COLLECTION).doc(anonymousVisitorKey(visitorId));

  const existing = await visitorRef.get();
  if (existing.exists) return anonymousVisitorSchema.parse(existing.data()).label;

  const counterRef = db.collection(COUNTER_COLLECTION).doc(COUNTER_DOC);
  let created = false;
  const label = await db.runTransaction(async (tx) => {
    // Decided afresh on every attempt, like `patternOperation` in
    // conversionFailures.ts: a retried attempt may find the visitor created.
    created = false;
    const visitorSnap = await tx.get(visitorRef);
    if (visitorSnap.exists) return anonymousVisitorSchema.parse(visitorSnap.data()).label;

    const counterSnap = await tx.get(counterRef);
    const number = lastNumberOf(counterSnap.exists ? counterSnap.data() : undefined) + 1;
    const visitor: AnonymousVisitor = {
      number,
      label: anonymousLabelFor(number),
      createdAt: new Date().toISOString(),
    };
    tx.set(counterRef, { lastNumber: number });
    tx.set(visitorRef, anonymousVisitorSchema.parse(visitor));
    created = true;
    return visitor.label;
  });

  if (created) {
    countWrites([
      { collection: COUNTER_COLLECTION, operation: "update" },
      { collection: VISITORS_COLLECTION, operation: "create" },
    ]);
  }
  return label;
}
