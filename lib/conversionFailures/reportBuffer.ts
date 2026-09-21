/**
 * Accumulates conversion-failure occurrences into count deltas, so one
 * request carries "this pattern happened 47 more times" instead of 47
 * requests carrying "it happened".
 *
 * ## What was wrong before, which is the reason this exists
 *
 * The reporter sent each distinct pattern at most once per mount. That is a
 * write-volume control, and it worked, but it also meant a document
 * containing one unmapped sequence nine hundred times incremented
 * `occurrenceCount` by exactly one. The stored frequency was not a noisy
 * estimate of how often a failure happens — it was a count of *browser
 * sessions that hit it at least once*, which is a different quantity wearing
 * the same name. Phase 5 would have prioritized mapping-table work from it.
 *
 * So batching here is not a trade of accuracy for cost. It fixes an existing
 * bias and reduces requests at the same time.
 *
 * ## What counts as an occurrence
 *
 * The converter re-runs on every debounced keystroke, so "occurrences seen in
 * the latest conversion" summed over conversions would overcount wildly — a
 * sequence typed once and then sat next to for twenty keystrokes is one
 * occurrence, not twenty.
 *
 * The rule here: per pattern, per session, the reported total is the
 * **high-water mark** of the count observed in a single conversion, and each
 * record contributes only the increase. Type more text containing the same
 * bad sequence and the count rises; delete text and it does not fall, and
 * nothing is reported. That is monotone, cannot be inflated by editing, and
 * is a defensible reading of "how many of these did this user actually
 * encounter".
 *
 * It is still not a perfect census — two separate documents pasted into the
 * same session report the larger, not the sum. Deliberate: the alternative
 * (summing every conversion) is wrong by orders of magnitude, while this is
 * wrong by at most the overlap between two pastes, and always in the
 * direction of understating.
 */
import { CONVERSION_FAILURE_LIMITS } from "./limits";
import type { BuiltFailureOccurrence } from "./occurrence";

/** One pattern's contribution to a batch. */
export interface BufferedReport {
  occurrence: BuiltFailureOccurrence;
  /** How many occurrences this entry stands for. At least 1. */
  occurrenceCount: number;
}

export interface ReportBufferOptions {
  /**
   * Called with a non-empty batch. May be async; a rejection is swallowed by
   * the buffer, because a failed report must never surface to a user who is
   * not looking at this pipeline.
   */
  flush: (items: BufferedReport[]) => void | Promise<void>;
  /** Flush immediately at this many distinct pending patterns. */
  maxItems?: number;
  /** Ceiling on a single entry's delta, mirroring the server's own bound. */
  maxOccurrenceCount?: number;
}

export interface ReportBuffer {
  /**
   * Records `observedCount` occurrences of one pattern seen in one
   * conversion. Returns the delta actually buffered, which is 0 when this
   * conversion saw no more of the pattern than an earlier one did.
   */
  record(key: string, occurrence: BuiltFailureOccurrence, observedCount: number): number;
  /** Distinct patterns waiting to be sent. */
  pendingCount(): number;
  /** Sends whatever is pending. A no-op when nothing is. */
  flushNow(): Promise<void>;
  /** Forgets pending entries *and* the high-water marks. For a new session. */
  reset(): void;
}

export function createReportBuffer(options: ReportBufferOptions): ReportBuffer {
  const {
    flush,
    maxItems = CONVERSION_FAILURE_LIMITS.maxFailuresPerReport,
    maxOccurrenceCount = CONVERSION_FAILURE_LIMITS.maxOccurrenceCount,
  } = options;

  /** Highest count seen for a pattern in any single conversion this session. */
  const highWater = new Map<string, number>();
  /** Deltas not yet sent, keyed the same way. */
  const pending = new Map<string, BufferedReport>();

  function send(): Promise<void> {
    if (pending.size === 0) return Promise.resolve();
    const batch = [...pending.values()];
    pending.clear();
    try {
      return Promise.resolve(flush(batch)).catch(() => undefined);
    } catch {
      // A synchronous throw from `flush` is as silent as an async one.
      return Promise.resolve();
    }
  }

  return {
    record(key, occurrence, observedCount) {
      const observed = Math.max(0, Math.floor(observedCount));
      if (observed === 0) return 0;

      const previous = highWater.get(key) ?? 0;
      if (observed <= previous) return 0;

      const delta = observed - previous;
      highWater.set(key, observed);

      const existing = pending.get(key);
      const total = Math.min((existing?.occurrenceCount ?? 0) + delta, maxOccurrenceCount);
      // The newest occurrence replaces the older one: same pattern, but a
      // context window from the text the user is looking at now.
      pending.set(key, { occurrence, occurrenceCount: total });

      if (pending.size >= maxItems) void send();
      return delta;
    },

    pendingCount() {
      return pending.size;
    },

    flushNow() {
      return send();
    },

    reset() {
      pending.clear();
      highWater.clear();
    },
  };
}
