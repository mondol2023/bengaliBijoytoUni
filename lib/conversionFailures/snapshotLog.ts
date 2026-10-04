/**
 * One structured stdout line per known-patterns snapshot *build* — the
 * server's view of what the fallback pipeline is able to serve.
 *
 * The pipeline itself runs in the browser, so the server never sees a
 * conversion. What it does see is the snapshot every pipeline-on client
 * fetches, and this line answers the rollout questions that live there: how
 * many accepted and how many unverified resolutions a deployment is
 * publishing per encoding, and whether `SERVE_UNVERIFIED_AI` was on when it
 * did. A non-zero `resolutionsUnverified` is unreviewed AI text on a public
 * endpoint, which is the alarm to watch for during a rollout.
 *
 * Same transport as `lib/firebase/writeMetrics.ts`: a JSON line on stdout
 * that a log drain or the Vercel runtime-log search can filter on `metric`.
 * One per build, not per request — a build happens at most once per cache
 * key per `SNAPSHOT_TTL_MS` per instance, so the line cannot flood. Request
 * volume is already in the platform's request logs for the path.
 *
 * Counts and identifiers only. No failed sequence, no candidate text, no
 * label, no caller.
 */
import type { KnownPatternsSnapshot } from "./knownPatterns";

/** An `encodingId` comes from an anonymous query string; only a plain id is logged as itself. */
const PLAIN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface KnownSnapshotBuiltEvent {
  readonly metric: "known_snapshot_built";
  readonly encodingId: string;
  readonly engineVersion: string;
  readonly serveUnverified: boolean;
  readonly patterns: number;
  readonly resolutionsAccepted: number;
  readonly resolutionsUnverified: number;
}

export function knownSnapshotBuiltEvent(
  snapshot: KnownPatternsSnapshot,
  serveUnverified: boolean,
): KnownSnapshotBuiltEvent {
  let accepted = 0;
  let unverified = 0;
  for (const resolution of snapshot.resolutions) {
    if (resolution.verification === "accepted") accepted += 1;
    else unverified += 1;
  }
  return {
    metric: "known_snapshot_built",
    encodingId:
      snapshot.encodingId === null
        ? "(none)"
        : PLAIN_ID.test(snapshot.encodingId)
          ? snapshot.encodingId
          : "(other)",
    engineVersion: snapshot.engineVersion,
    serveUnverified,
    patterns: snapshot.patterns.length,
    resolutionsAccepted: accepted,
    resolutionsUnverified: unverified,
  };
}

/** Never throws: a log line must not fail the request it describes. */
export function emitKnownSnapshotBuilt(
  snapshot: KnownPatternsSnapshot,
  serveUnverified: boolean,
  emit: (line: string) => void = (line) => console.log(line),
): void {
  try {
    emit(JSON.stringify(knownSnapshotBuiltEvent(snapshot, serveUnverified)));
  } catch {
    // Instrumentation is never worth an error in the path it instruments.
  }
}
