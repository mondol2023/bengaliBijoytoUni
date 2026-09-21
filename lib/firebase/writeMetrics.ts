/**
 * Counts Firestore writes, so the "do we need Redis in front of this"
 * question can be answered with a number instead of an intuition.
 *
 * ## Why it does not store the metrics in Firestore
 *
 * The obvious implementation — a counters document incremented on every
 * write — costs one write per write, doubling the quantity being measured
 * and changing the answer it exists to inform. The one thing an instrument
 * must not do is move the needle it is reading.
 *
 * So counting happens in memory and reporting happens through **stdout**, as
 * one structured line per interval. A log drain can sum those lines across
 * every instance and every cold start at no storage cost. The per-instance
 * snapshot is also readable live at `GET /api/admin/write-metrics`.
 *
 * ## What the numbers are honest about
 *
 * In-process counters are per instance and die with it. On a serverless host
 * there may be many instances, so the admin endpoint shows *an* instance, not
 * the deployment — which is exactly why the emitted log lines carry an
 * `instanceId` and a day bucket: summing them is the deployment-wide number,
 * and the endpoint is the live sanity check.
 *
 * Counts are of *document writes attempted*, incremented at the call site
 * around the Firestore call. A write that then fails is still counted, which
 * is the conservative direction for a capacity question: a failed write
 * costs a round trip and often a retry.
 *
 * ## Scope today
 *
 * Only `lib/firebase/conversionFailures.ts` is instrumented — the collection
 * the caching question is actually about, and the only one whose volume
 * scales with anonymous traffic rather than with signed-in actions. Other
 * writers adopt this by calling `countWrite` next to their own write; the
 * module is deliberately dependency-free so that is a one-line change.
 */

export type WriteOperation = "create" | "update" | "delete";

export interface WriteMetricEvent {
  collection: string;
  operation: WriteOperation;
  /** Document writes this event stands for. Defaults to 1. */
  documents?: number;
}

export interface WriteMetricsDay {
  total: number;
  byCollection: Record<string, { total: number; byOperation: Partial<Record<WriteOperation, number>> }>;
}

export interface WriteMetricsSnapshot {
  /** Distinguishes instances in drained logs; random per process, not a secret. */
  instanceId: string;
  startedAt: string;
  /** UTC date (`YYYY-MM-DD`) -> counts. At most `MAX_DAYS` entries. */
  days: Record<string, WriteMetricsDay>;
  /** Everything this process has counted since it started. */
  processTotal: number;
}

/** A week is enough to see a weekday/weekend shape; instances rarely live that long anyway. */
const MAX_DAYS = 7;

/** One emitted line per interval of activity, not one per write. */
const EMIT_INTERVAL_MS = 60_000;

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function randomInstanceId(): string {
  // `crypto.randomUUID` exists in Node 18+ and in the browser; this module is
  // server-side, but the fallback keeps it from throwing anywhere.
  try {
    return globalThis.crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(16).slice(2, 10);
  }
}

interface MetricsState {
  instanceId: string;
  startedAt: string;
  days: Map<string, WriteMetricsDay>;
  processTotal: number;
  /** Counts not yet included in an emitted line. */
  pending: Map<string, number>;
  nextEmitAt: number;
}

function createState(now: number): MetricsState {
  return {
    instanceId: randomInstanceId(),
    startedAt: new Date(now).toISOString(),
    days: new Map(),
    processTotal: 0,
    pending: new Map(),
    nextEmitAt: now + EMIT_INTERVAL_MS,
  };
}

let state = createState(Date.now());

export interface CountWriteOptions {
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable sink, for tests. Defaults to one structured line on stdout. */
  emit?: (line: string) => void;
}

function defaultEmit(line: string): void {
  // The log line is the transport, not a debug aid — see the module doc.
  console.log(line);
}

function record(event: WriteMetricEvent, now: number): void {
  const documents = Math.max(0, Math.floor(event.documents ?? 1));
  if (documents === 0) return;

  const day = utcDay(now);
  let bucket = state.days.get(day);
  if (bucket === undefined) {
    bucket = { total: 0, byCollection: {} };
    state.days.set(day, bucket);
    // Oldest first: `Map` preserves insertion order and days only ever
    // advance, so the first key is always the oldest.
    while (state.days.size > MAX_DAYS) {
      const oldest = state.days.keys().next();
      if (oldest.done) break;
      state.days.delete(oldest.value);
    }
  }

  const perCollection = (bucket.byCollection[event.collection] ??= { total: 0, byOperation: {} });
  bucket.total += documents;
  perCollection.total += documents;
  perCollection.byOperation[event.operation] =
    (perCollection.byOperation[event.operation] ?? 0) + documents;

  state.processTotal += documents;

  const pendingKey = `${event.collection}:${event.operation}`;
  state.pending.set(pendingKey, (state.pending.get(pendingKey) ?? 0) + documents);
}

function emitIfDue(now: number, emit: (line: string) => void): void {
  if (now < state.nextEmitAt || state.pending.size === 0) return;
  const deltas: Record<string, number> = {};
  let total = 0;
  for (const [key, count] of state.pending) {
    deltas[key] = count;
    total += count;
  }
  state.pending.clear();
  state.nextEmitAt = now + EMIT_INTERVAL_MS;
  emit(
    JSON.stringify({
      metric: "firestore_writes",
      instanceId: state.instanceId,
      day: utcDay(now),
      windowMs: EMIT_INTERVAL_MS,
      total,
      deltas,
    }),
  );
}

/** Counts one or more document writes. Never throws; a broken counter must not fail a request. */
export function countWrite(event: WriteMetricEvent, options: CountWriteOptions = {}): void {
  try {
    const now = (options.now ?? Date.now)();
    record(event, now);
    emitIfDue(now, options.emit ?? defaultEmit);
  } catch {
    // Instrumentation is never worth an error in the path it instruments.
  }
}

/** Several writes from one operation (a transaction, a batch) in one call. */
export function countWrites(events: WriteMetricEvent[], options: CountWriteOptions = {}): void {
  for (const event of events) countWrite(event, options);
}

export function getWriteMetricsSnapshot(): WriteMetricsSnapshot {
  return {
    instanceId: state.instanceId,
    startedAt: state.startedAt,
    days: Object.fromEntries(
      [...state.days.entries()].map(([day, bucket]) => [
        day,
        {
          total: bucket.total,
          byCollection: Object.fromEntries(
            Object.entries(bucket.byCollection).map(([collection, counts]) => [
              collection,
              { total: counts.total, byOperation: { ...counts.byOperation } },
            ]),
          ),
        },
      ]),
    ),
    processTotal: state.processTotal,
  };
}

/** Forces the pending line out, e.g. before reading a snapshot in a test. */
export function flushWriteMetrics(options: CountWriteOptions = {}): void {
  const now = (options.now ?? Date.now)();
  state.nextEmitAt = 0;
  emitIfDue(now, options.emit ?? defaultEmit);
}

export function __resetWriteMetricsForTests(now = Date.now()): void {
  state = createState(now);
}
