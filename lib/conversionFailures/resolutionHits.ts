/**
 * Batched counting of served resolutions.
 *
 * `hitCount` orders what the snapshot publishes, so it is read on every
 * rebuild — but it must not cost a Firestore write per served result.
 * Firestore also caps sustained writes to a single document at roughly one
 * per second, and a popular resolution would sit above that. So hits
 * accumulate in memory and flush as one atomic `increment` per document.
 *
 * What is deliberately accepted: a flush that never happens loses the hits
 * it was holding. A count of how often a resolution helped is not
 * accounting — it decides ranking, and a ranking that is slightly stale is
 * fine where a doubled write bill is not. The counter therefore never
 * blocks the response and never surfaces an error to the caller.
 *
 * The Firestore write itself is injected, so this module holds no Firebase
 * import and can be tested exhaustively without one. It also keeps the
 * module usable from the serving path, which must not reach into `lib/ai`.
 */

/** One document's accumulated hits since the last flush. */
export interface PendingHits {
  readonly resolutionId: string;
  readonly hits: number;
  /** The most recent moment this resolution was served, ISO. */
  readonly lastUsedAt: string;
}

export interface HitCounterOptions {
  /** Applies the deltas. Resolving means they were written; rejecting means they are dropped. */
  readonly flush: (pending: readonly PendingHits[]) => Promise<void>;
  /** Flush once this many distinct documents are pending. */
  readonly flushAtPending?: number;
  /** Injected for tests, and so the flush timestamp is the serve time rather than the write time. */
  readonly now?: () => Date;
  /** Reported rather than thrown — a counter must never break the thing it is counting. */
  readonly onFlushError?: (cause: unknown) => void;
}

export interface HitCounter {
  /** Records one served hit. Never throws, never awaits a write. */
  record(resolutionId: string): void;
  /** Flushes everything pending. Safe to call with nothing pending. */
  flushNow(): Promise<void>;
  /** Distinct documents currently held. For tests and for the flush threshold. */
  pending(): number;
}

export const DEFAULT_FLUSH_AT_PENDING = 25;

export function createHitCounter(options: HitCounterOptions): HitCounter {
  const flushAtPending = options.flushAtPending ?? DEFAULT_FLUSH_AT_PENDING;
  const now = options.now ?? (() => new Date());
  const buffer = new Map<string, { hits: number; lastUsedAt: string }>();

  /**
   * Serializes flushes. Two concurrent flushes could otherwise both drain
   * the buffer and write overlapping deltas, double-counting whatever was
   * added between the two drains.
   */
  let inFlight: Promise<void> = Promise.resolve();

  async function drain(): Promise<void> {
    if (buffer.size === 0) return;
    const pending: PendingHits[] = [];
    for (const [resolutionId, entry] of buffer) {
      pending.push({ resolutionId, hits: entry.hits, lastUsedAt: entry.lastUsedAt });
    }
    // Cleared before the await, not after: a hit arriving during the write
    // belongs to the next batch. Clearing afterwards would discard it.
    buffer.clear();
    try {
      await options.flush(pending);
    } catch (cause) {
      options.onFlushError?.(cause);
    }
  }

  function scheduleDrain(): Promise<void> {
    inFlight = inFlight.then(drain, drain);
    return inFlight;
  }

  return {
    record(resolutionId: string) {
      if (resolutionId === "") return;
      const at = now().toISOString();
      const existing = buffer.get(resolutionId);
      if (existing) {
        existing.hits += 1;
        existing.lastUsedAt = at;
      } else {
        buffer.set(resolutionId, { hits: 1, lastUsedAt: at });
      }
      if (buffer.size >= flushAtPending) {
        void scheduleDrain();
      }
    },

    flushNow() {
      return scheduleDrain();
    },

    pending() {
      return buffer.size;
    },
  };
}
