/**
 * Server-only writer + reader for the `errorLogs` collection — the record of
 * every conversion that failed, file that could not be extracted, and letter
 * that had no mapping rule.
 *
 * Two things feed it: the browser (via `/api/error-logs`, for failures that
 * happen in the client-side conversion pipeline, which never touches a
 * server otherwise) and server routes themselves (via `captureServerIssue`
 * below, for extraction/usage failures on `/api/documents/extract`).
 *
 * Like `adminStats`, a failed write here is logged and swallowed by
 * `captureServerIssue` rather than propagated: losing one log row is bad,
 * failing the user's request because the *logging* broke is worse. The
 * browser-facing route keeps its own error handling instead, so a client can
 * tell whether its report landed.
 */
import { getAdminDb } from "./admin";
import { errorLogSchema, type ErrorLog } from "./schemas";
import { logAppError } from "@/lib/errors/handlers";

const COLLECTION = "errorLogs";

/** Bounds what one row can carry — see `errorLogSchema`'s note on `samples`. */
export const ERROR_LOG_LIMITS = {
  maxSamples: 20,
  maxSampleLength: 60,
  maxMessageLength: 500,
} as const;

export type ErrorLogInput = Omit<ErrorLog, "createdAt" | "occurrences" | "samples"> & {
  occurrences?: number;
  samples?: string[];
};

function clampSamples(samples: string[]): string[] {
  return samples
    .slice(0, ERROR_LOG_LIMITS.maxSamples)
    .map((sample) => sample.slice(0, ERROR_LOG_LIMITS.maxSampleLength));
}

export async function writeErrorLog(input: ErrorLogInput): Promise<string> {
  const record: ErrorLog = {
    ...input,
    message: input.message.slice(0, ERROR_LOG_LIMITS.maxMessageLength),
    samples: clampSamples(input.samples ?? []),
    occurrences: input.occurrences ?? 1,
    createdAt: new Date().toISOString(),
  };
  const validated = errorLogSchema.parse(record);
  const ref = getAdminDb().collection(COLLECTION).doc();
  await ref.set(validated);
  return ref.id;
}

/**
 * Best-effort capture from inside a server route. Never throws — call it on
 * the failure path and return the real response regardless of what it does.
 */
export async function captureServerIssue(input: ErrorLogInput): Promise<void> {
  try {
    await writeErrorLog(input);
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to write an error-log entry.", debug: cause },
      { route: input.route ?? "unknown" },
    );
  }
}

export type WithId<T> = T & { id: string };

export interface ListErrorLogsOptions {
  limit: number;
  /** Restrict to one user's own rows — how a signed-in user reads their own log. */
  userId?: string;
  kind?: ErrorLog["kind"];
  severity?: ErrorLog["severity"];
}

/**
 * Newest-first listing. Every combination of filters used here is backed by a
 * composite index in `firestore.indexes.json`; adding a new filter pair means
 * adding the matching index there too.
 */
export async function listErrorLogs(options: ListErrorLogsOptions): Promise<WithId<ErrorLog>[]> {
  let query = getAdminDb().collection(COLLECTION) as FirebaseFirestore.Query;
  if (options.userId) query = query.where("userId", "==", options.userId);
  if (options.kind) query = query.where("kind", "==", options.kind);
  if (options.severity) query = query.where("severity", "==", options.severity);

  const snapshot = await query.orderBy("createdAt", "desc").limit(options.limit).get();
  return snapshot.docs.flatMap((doc) => {
    const parsed = errorLogSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });
}

export interface ErrorLogSummary {
  total: number;
  byKind: Record<string, number>;
  bySeverity: Record<string, number>;
  /** Most frequently failing legacy sequences across the returned rows, worst first. */
  topSamples: { sample: string; count: number }[];
}

/**
 * Derived from the rows already fetched, not from a second aggregate query —
 * the admin log page shows a capped window (most recent N) and the summary
 * describes exactly that window, which is cheaper and impossible to get out
 * of sync with the list below it.
 */
export function summarizeErrorLogs(entries: ErrorLog[]): ErrorLogSummary {
  const byKind: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const sampleCounts = new Map<string, number>();

  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + entry.occurrences;
    bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + entry.occurrences;
    for (const sample of entry.samples) {
      sampleCounts.set(sample, (sampleCounts.get(sample) ?? 0) + entry.occurrences);
    }
  }

  const topSamples = Array.from(sampleCounts, ([sample, count]) => ({ sample, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    total: entries.reduce((sum, entry) => sum + entry.occurrences, 0),
    byKind,
    bySeverity,
    topSamples,
  };
}
