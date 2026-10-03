/**
 * The cross-instance counter store: one Firestore document per counter,
 * reserved in a transaction and moved with `FieldValue.increment`.
 *
 * The deployment is Vercel (serverless, potentially many concurrent
 * instances), so a module-level `Map` bounds one instance and resets on every
 * cold start. A Firestore document is the shared state every instance sees —
 * the same pattern `failurePatterns.occurrenceCount` already uses.
 *
 * ## Why a transaction around the increment
 *
 * `FieldValue.increment` alone is atomic but blind: it cannot refuse at a
 * ceiling, so "increment, then read back and decide" would let a burst all
 * increment past the limit before any of them looked. Reading inside the
 * transaction makes the check and the increment one step — Firestore retries
 * the transaction if another instance moved the count in between, so no two
 * callers can both take the last unit. A refusal writes nothing, which keeps
 * a flood of refused requests at one read each rather than a read and a
 * write.
 *
 * Document shape: `{ count: number, expireAt: Date }`. `expireAt` is a
 * `Date` for the reason `lib/conversionFailures/retention.ts` gives — a
 * Firestore TTL policy only acts on a timestamp field. The TTL policies
 * themselves are console-only; see `docs/pending-manual-steps.md`.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./admin";
import { countWrites } from "./writeMetrics";
import type { CounterSlot, CounterStore, ReserveOutcome } from "@/lib/security/counterStore";

/**
 * The only collections this store will touch. A counter writes `expireAt`,
 * and `aiResolutions` must never carry one (accepted resolutions do not
 * expire — `lib/conversionFailures/retention.ts`), nor may a counter land in
 * an evidence collection. Naming the collections here turns that from a
 * convention into a refusal; `__tests__/sharedCounter.test.ts` pins the list.
 */
export const SHARED_COUNTER_COLLECTIONS: ReadonlySet<string> = new Set(["aiCallBudget"]);

function assertCounterCollection(collection: string): void {
  if (!SHARED_COUNTER_COLLECTIONS.has(collection)) {
    throw new Error(`"${collection}" is not a shared counter collection.`);
  }
}

function countOf(data: unknown): number {
  if (typeof data !== "object" || data === null) return 0;
  const count = (data as { count?: unknown }).count;
  // A malformed or negative stored count reads as zero rather than as a
  // reason to throw; the ceiling still holds from the next write on.
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 0;
}

export const firestoreCounterStore: CounterStore = {
  async reserve(slot: CounterSlot): Promise<ReserveOutcome> {
    assertCounterCollection(slot.collection);
    const db = getAdminDb();
    const ref = db.collection(slot.collection).doc(slot.docId);
    const outcome = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const current = countOf(snapshot.exists ? snapshot.data() : undefined);
      if (current >= slot.limit) return { admitted: false as const, count: current };
      tx.set(ref, { count: FieldValue.increment(1), expireAt: slot.expireAt }, { merge: true });
      return { admitted: true as const, count: current + 1 };
    });
    if (outcome.admitted) countWrites([{ collection: slot.collection, operation: "update" }]);
    return outcome;
  },

  async release(slot) {
    assertCounterCollection(slot.collection);
    const db = getAdminDb();
    const ref = db.collection(slot.collection).doc(slot.docId);
    const released = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (countOf(snapshot.exists ? snapshot.data() : undefined) <= 0) return false;
      tx.update(ref, { count: FieldValue.increment(-1) });
      return true;
    });
    if (released) countWrites([{ collection: slot.collection, operation: "update" }]);
  },

  async read(slot) {
    assertCounterCollection(slot.collection);
    const snapshot = await getAdminDb().collection(slot.collection).doc(slot.docId).get();
    return countOf(snapshot.exists ? snapshot.data() : undefined);
  },
};
