/**
 * The in-session failure log the user actually sees: every conversion error,
 * failed file extraction, and letter that had no mapping rule, collected
 * across the whole app rather than per-page.
 *
 * It lives in a module-level store (not a React context) for one concrete
 * reason: text conversion, document upload and comparison are three separate
 * routes, and a context would reset on every client navigation between them
 * — exactly when a user is most likely to be comparing "it failed on the
 * pasted text too". Components subscribe with `useSyncExternalStore` (see
 * `hooks/useConversionLog.ts`).
 *
 * Identical issues are merged rather than appended: retyping one character
 * re-runs the whole conversion, so an append-only log would show the same
 * unmapped letter fifty times and bury everything else. The merge is also
 * what keeps backend reporting cheap — `lib/log/reportIssue.ts` only posts
 * the first occurrence of each distinct issue.
 *
 * Everything above the store itself is pure and unit-tested in
 * `conversionLog.test.ts`.
 */

export type LogEventKind =
  | "unmapped_character"
  | "conversion_failed"
  | "file_extraction_failed"
  | "validation_warning"
  | "limit_exceeded"
  | "rate_limited"
  | "unknown";

export type LogSeverity = "error" | "warning";
export type LogSource = "text" | "file" | "comparison";

export interface ConversionLogEvent {
  id: string;
  kind: LogEventKind;
  severity: LogSeverity;
  source: LogSource;
  /** `AppErrorCode` where one exists, else a kind-specific constant. */
  code: string;
  message: string;
  encodingId: string | null;
  fileName: string | null;
  fileType: string | null;
  /** The legacy sequences that actually failed to convert. */
  samples: string[];
  /** ISO timestamp of the first occurrence. */
  firstSeenAt: string;
  /** ISO timestamp of the most recent occurrence. */
  lastSeenAt: string;
  occurrences: number;
}

export type ConversionLogInput = Omit<
  ConversionLogEvent,
  "id" | "firstSeenAt" | "lastSeenAt" | "occurrences" | "encodingId" | "fileName" | "fileType" | "samples"
> & {
  encodingId?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  samples?: string[];
};

/** Oldest rows fall off past this — a log that grows unbounded in a long session is a leak. */
export const MAX_LOG_EVENTS = 200;

/**
 * What makes two reports "the same issue". Deliberately includes the samples
 * and the file name: the same `conversion_failed` message on two different
 * files is two separate problems to a user, while the same unmapped letter
 * seen twice is one.
 */
export function eventKey(input: ConversionLogInput): string {
  return [
    input.kind,
    input.source,
    input.code,
    input.encodingId ?? "",
    input.fileName ?? "",
    input.message,
    (input.samples ?? []).join("\u0001"),
  ].join("|");
}

export interface AppendResult {
  events: ConversionLogEvent[];
  /** The merged-or-created row. */
  event: ConversionLogEvent;
  /** False when this merged into an existing row — the signal not to re-report it. */
  isNew: boolean;
}

/**
 * Pure log reducer. Newest-first ordering: a merged row moves back to the
 * top, because "this just happened again" is the thing worth seeing.
 */
export function appendEvent(
  events: ConversionLogEvent[],
  input: ConversionLogInput,
  meta: { id: string; now: string },
): AppendResult {
  const key = eventKey(input);
  const existing = events.find((event) => eventKey(event) === key);

  if (existing) {
    const merged: ConversionLogEvent = {
      ...existing,
      lastSeenAt: meta.now,
      occurrences: existing.occurrences + 1,
    };
    return {
      events: [merged, ...events.filter((event) => event !== existing)],
      event: merged,
      isNew: false,
    };
  }

  const created: ConversionLogEvent = {
    id: meta.id,
    kind: input.kind,
    severity: input.severity,
    source: input.source,
    code: input.code,
    message: input.message,
    encodingId: input.encodingId ?? null,
    fileName: input.fileName ?? null,
    fileType: input.fileType ?? null,
    samples: input.samples ?? [],
    firstSeenAt: meta.now,
    lastSeenAt: meta.now,
    occurrences: 1,
  };
  return { events: [created, ...events].slice(0, MAX_LOG_EVENTS), event: created, isNew: true };
}

export interface LogCounts {
  errors: number;
  warnings: number;
  /** Distinct legacy sequences that failed to map, across every row. */
  unmappedSamples: string[];
}

export function summarizeLog(events: ConversionLogEvent[]): LogCounts {
  const unmapped = new Set<string>();
  let errors = 0;
  let warnings = 0;

  for (const event of events) {
    if (event.severity === "error") errors += 1;
    else warnings += 1;
    if (event.kind === "unmapped_character") {
      for (const sample of event.samples) unmapped.add(sample);
    }
  }

  return { errors, warnings, unmappedSamples: Array.from(unmapped) };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Listener = () => void;

let events: ConversionLogEvent[] = [];
const listeners = new Set<Listener>();
let nextId = 0;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Identity is stable until something actually changes — required by `useSyncExternalStore`. */
export function getLogSnapshot(): ConversionLogEvent[] {
  return events;
}

/** The server render has no session log; a stable empty array avoids a hydration mismatch. */
const SERVER_SNAPSHOT: ConversionLogEvent[] = [];
export function getLogServerSnapshot(): ConversionLogEvent[] {
  return SERVER_SNAPSHOT;
}

export function logIssue(input: ConversionLogInput): AppendResult {
  nextId += 1;
  const result = appendEvent(events, input, { id: `evt-${nextId}`, now: new Date().toISOString() });
  events = result.events;
  emit();
  return result;
}

export function clearLog(): void {
  if (events.length === 0) return;
  events = [];
  emit();
}

/** Test-only reset so store state can't leak between cases. */
export function __resetLogForTests(): void {
  events = [];
  nextId = 0;
  listeners.clear();
}
