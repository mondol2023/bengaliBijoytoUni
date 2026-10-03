/**
 * The one shape every bounded counter in this app reserves against: the
 * per-admin AI call budget (`lib/ai/costCap.ts`) and the request rate
 * limiter (`lib/security/sharedRateLimit.ts`).
 *
 * ## Why an interface, and not Firestore directly
 *
 * The deployment is Vercel — serverless, potentially many concurrent
 * instances — so a counter held in module memory bounds one instance, not
 * the deployment. The real implementation is therefore a Firestore document
 * (`lib/firebase/sharedCounter.ts`). But the *rules* of a counter (when it
 * refuses, that it never goes negative, that the refusal writes nothing) are
 * worth testing without a database, and `lib/ai/*` deliberately keeps
 * Firestore out of every module but two. So the decision code takes a store,
 * and the Firestore store is plugged in at the one call site allowed to know
 * about it.
 *
 * This module imports nothing, so it is safe anywhere.
 */

/** One counter: a document, the ceiling it may not pass, and when it may be thrown away. */
export interface CounterSlot {
  /** Firestore collection for the shared store; a namespace for the in-memory one. */
  readonly collection: string;
  /** Must be a valid Firestore document id: no `/`, not `.` or `..`. */
  readonly docId: string;
  readonly limit: number;
  /**
   * When the counter stops mattering. Written alongside the count so a
   * Firestore TTL policy on `expireAt` can delete spent windows; the decision
   * never reads it.
   */
  readonly expireAt: Date;
}

export type ReserveOutcome =
  | { readonly admitted: true; readonly count: number }
  | { readonly admitted: false; readonly count: number };

export interface CounterStore {
  /**
   * Atomically: if the count is below `limit`, add one and admit; otherwise
   * refuse **without writing**. The count after the call is reported either
   * way.
   */
  reserve(slot: CounterSlot): Promise<ReserveOutcome>;
  /** Gives one unit back. Never takes the count below zero. */
  release(slot: Pick<CounterSlot, "collection" | "docId">): Promise<void>;
  /** The current count, zero when the counter does not exist yet. */
  read(slot: Pick<CounterSlot, "collection" | "docId">): Promise<number>;
}

/**
 * A process-local store. What the counters were before the deployment answer,
 * and still the right thing for a test or a single long-running server — but
 * on Vercel it bounds one instance, which is the gap the Firestore store
 * closes. Two budgets or limiters sharing *one* of these behave like two
 * instances sharing Firestore, which is how the cross-instance property is
 * tested.
 */
export function createMemoryCounterStore(): CounterStore {
  const counts = new Map<string, number>();
  const keyOf = (slot: Pick<CounterSlot, "collection" | "docId">) => `${slot.collection}/${slot.docId}`;

  return {
    async reserve(slot) {
      const key = keyOf(slot);
      const current = counts.get(key) ?? 0;
      if (current >= slot.limit) return { admitted: false, count: current };
      counts.set(key, current + 1);
      return { admitted: true, count: current + 1 };
    },
    async release(slot) {
      const key = keyOf(slot);
      const current = counts.get(key) ?? 0;
      if (current > 0) counts.set(key, current - 1);
    },
    async read(slot) {
      return counts.get(keyOf(slot)) ?? 0;
    },
  };
}
