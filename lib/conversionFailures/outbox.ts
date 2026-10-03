/**
 * A browser-side queue of conversion-failure reports waiting to be sent,
 * kept in `localStorage` so a report survives a tab that is closed, crashes,
 * or goes offline before it could be delivered — the next visit sends it.
 *
 * Sits between `ReportBuffer` (which turns conversions into count deltas,
 * in memory) and the network: the buffer flushes into this outbox every few
 * seconds, and the outbox is drained to `/api/conversion-failures` on a
 * slower timer (`useConversionFailureReporter`).
 *
 * ## At most once, never twice
 *
 * A delivered report increments `occurrenceCount`, so sending one twice
 * inflates the aggregate. A batch is therefore removed from storage *before*
 * it is sent, and put back only when the send is observed to fail. A page
 * killed mid-request loses that one batch rather than resending it next
 * visit — understating, which is the direction every other counting rule in
 * this pipeline errs in too (see `reportBuffer.ts`).
 *
 * ## Bounded
 *
 * At most `maxBatches` batches, each at most one request's worth of
 * failures, and none older than `maxAgeMs`: a visitor who returns after a
 * month does not upload a month-old engine's failures. Storage that throws —
 * private browsing, a full quota, site data blocked — degrades to an
 * in-memory queue for the page's lifetime rather than to no reporting.
 *
 * Multiple tabs share the one queue. Every write re-reads storage first, so
 * one tab's enqueue is not overwritten by another tab's removal; the hook
 * additionally holds a Web Lock while draining, so two tabs do not send the
 * same batch.
 */

/** The subset of `Storage` this module uses — injectable for tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Who a batch was recorded as, decided when it was queued, not when it is
 * sent — so a report made while signed out is never attributed to an account
 * signed into later on the same browser, and vice versa. `unknown` covers a
 * batch queued before the initial sign-in check finished.
 */
export type OutboxAuth =
  | { kind: "anonymous"; visitorId: string }
  | { kind: "user"; uid: string }
  | { kind: "unknown" };

export interface OutboxBatch<F> {
  id: string;
  createdAt: number;
  auth: OutboxAuth;
  failures: F[];
}

/**
 * `delivered` and `rejected` both end a batch's life — a rejection (a 4xx
 * other than rate limiting) will not succeed on resend. `retry` puts it back.
 */
export type SendOutcome = "delivered" | "rejected" | "retry";

export interface FailureOutboxOptions<F> {
  storage: StorageLike | null;
  send: (batch: OutboxBatch<F>) => Promise<SendOutcome>;
  key?: string;
  maxBatches?: number;
  maxAgeMs?: number;
  now?: () => number;
  newId?: () => string;
}

export interface FailureOutbox<F> {
  enqueue(failures: F[], auth: OutboxAuth): void;
  /** Sends queued batches oldest first, stopping at the first failed send. */
  drain(): Promise<void>;
  pending(): OutboxBatch<F>[];
}

export const FAILURE_OUTBOX_STORAGE_KEY = "convert2uni.failureOutbox";
export const DEFAULT_OUTBOX_MAX_BATCHES = 20;
export const DEFAULT_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How often the reporter hook sends the outbox to the database. Reports are
 * cached in the browser for up to this long, so a burst of activity becomes
 * a few requests rather than one per flush. A hidden or closing page sends
 * immediately. Stated in the privacy disclosure (`lib/privacy/disclosure.ts`).
 */
export const OUTBOX_DRAIN_INTERVAL_MS = 2 * 60_000;

function isAuth(value: unknown): value is OutboxAuth {
  if (typeof value !== "object" || value === null) return false;
  const auth = value as Record<string, unknown>;
  if (auth.kind === "anonymous") return typeof auth.visitorId === "string";
  if (auth.kind === "user") return typeof auth.uid === "string";
  return auth.kind === "unknown";
}

function isBatch(value: unknown): value is OutboxBatch<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const batch = value as Record<string, unknown>;
  return (
    typeof batch.id === "string" &&
    typeof batch.createdAt === "number" &&
    Array.isArray(batch.failures) &&
    isAuth(batch.auth)
  );
}

export function createFailureOutbox<F>(options: FailureOutboxOptions<F>): FailureOutbox<F> {
  const key = options.key ?? FAILURE_OUTBOX_STORAGE_KEY;
  const maxBatches = options.maxBatches ?? DEFAULT_OUTBOX_MAX_BATCHES;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_OUTBOX_MAX_AGE_MS;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => crypto.randomUUID());

  let storage = options.storage;
  let memory: OutboxBatch<F>[] = [];
  let draining: Promise<void> | null = null;

  function read(): OutboxBatch<F>[] {
    if (storage === null) return memory;
    try {
      const raw = storage.getItem(key);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed.filter(isBatch) as OutboxBatch<F>[]) : [];
    } catch (cause) {
      if (cause instanceof SyntaxError) return [];
      // Storage itself is unusable: carry on in memory from here.
      storage = null;
      return memory;
    }
  }

  function write(batches: OutboxBatch<F>[]): void {
    const bounded = batches.slice(-maxBatches);
    if (storage !== null) {
      try {
        if (bounded.length === 0) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(bounded));
        return;
      } catch {
        storage = null;
      }
    }
    memory = bounded;
  }

  function fresh(batches: OutboxBatch<F>[]): OutboxBatch<F>[] {
    const cutoff = now() - maxAgeMs;
    return batches.filter((batch) => batch.createdAt >= cutoff);
  }

  async function drainOnce(): Promise<void> {
    const queued = fresh(read());
    write(queued);
    for (const { id } of queued) {
      // Re-read each time: another tab may have taken or added batches.
      const current = read();
      const batch = current.find((candidate) => candidate.id === id);
      if (!batch) continue;
      write(current.filter((candidate) => candidate.id !== id));

      let outcome: SendOutcome;
      try {
        outcome = await options.send(batch);
      } catch {
        outcome = "retry";
      }
      if (outcome === "retry") {
        write([batch, ...read().filter((candidate) => candidate.id !== id)]);
        return;
      }
    }
  }

  return {
    enqueue(failures, auth) {
      if (failures.length === 0) return;
      write([...fresh(read()), { id: newId(), createdAt: now(), auth, failures }]);
    },
    drain() {
      draining ??= drainOnce().finally(() => {
        draining = null;
      });
      return draining;
    },
    pending() {
      return fresh(read());
    },
  };
}

/** `window.localStorage`, or null where reading it throws or there is no window. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
