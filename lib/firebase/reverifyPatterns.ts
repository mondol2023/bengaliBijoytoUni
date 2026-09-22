/**
 * The engine-change trigger: a pass over stored patterns, marking the ones
 * the current engine now converts.
 *
 * This is the trigger that matters. A table fix is how a gap actually
 * closes, and without this pass the patterns it closed stay open forever
 * and keep the admin's queue full of work that is already done.
 *
 * All the judgement is in `lib/conversionFailures/reverify.ts`, which is
 * pure and has no database in scope. This module reads, hands the documents
 * to the planner, and applies what comes back — so "what would a sweep
 * change" is answerable in a test without Firestore, and the apply step has
 * no decision in it.
 *
 * **It only ever writes `status`.** No deletes, and it does not touch the
 * occurrence count, the retention stamp or the occurrences themselves: a
 * bad engine change must not be able to erase the evidence of what it
 * broke.
 *
 * Bounded per call, like every other admin read here — one capped window,
 * re-runnable. An unbounded pass over a collection whose size is set by
 * anonymous traffic is not something an HTTP handler should start.
 */
import { listFailurePatterns } from "./conversionFailures";
import { getAdminDb } from "./admin";
import { countWrites } from "./writeMetrics";
import { getEncoding } from "@/features/converter/encodings/registry";
import { AppErrors, err, ok, type AppError, type Result } from "@/lib/errors/types";
import {
  planReverifySweep,
  type ReverifyStatusChange,
  type SweepablePattern,
} from "@/lib/conversionFailures/reverify";

const PATTERNS_COLLECTION = "failurePatterns";

/** Matches the admin list's capped window, for the same reason. */
export const REVERIFY_SWEEP_LIMIT = 200;

export interface ReverifySweepOptions {
  /** One encoding at a time: the sweep exists because a rule table changed. */
  readonly encodingId?: string;
  readonly limit?: number;
}

export interface ReverifySweepReport {
  readonly examined: number;
  readonly resolved: readonly string[];
  readonly reopened: readonly string[];
}

function reportOf(changes: readonly ReverifyStatusChange[], examined: number): ReverifySweepReport {
  return {
    examined,
    resolved: changes.filter((change) => change.status === "resolved").map((change) => change.id),
    reopened: changes.filter((change) => change.status === "open").map((change) => change.id),
  };
}

/**
 * Reads a window of patterns, re-runs the engine over each stored sequence,
 * and writes back only the statuses that disagree with it.
 *
 * The encoding is checked here rather than in the route: the route sits
 * under `app/api/admin/conversion-failures`, which
 * `lib/ai/__tests__/invariants.test.ts` forbids from reaching into
 * `features/converter/encodings` at all. That guard is worth more than the
 * convenience of validating one field a layer earlier.
 */
export async function reverifyStoredPatterns(
  options: ReverifySweepOptions = {},
): Promise<Result<ReverifySweepReport, AppError>> {
  if (options.encodingId !== undefined && !getEncoding(options.encodingId)) {
    return err(
      AppErrors.validation(`Unknown encoding "${options.encodingId}".`, {
        details: { field: "encodingId" },
      }),
    );
  }

  const limit = Math.min(options.limit ?? REVERIFY_SWEEP_LIMIT, REVERIFY_SWEEP_LIMIT);
  const patterns = await listFailurePatterns({ encodingId: options.encodingId, limit });

  const sweepable: SweepablePattern[] = patterns.map((pattern) => ({
    id: pattern.id,
    encodingId: pattern.encodingId,
    failedSequence: pattern.failedSequence,
    engineVersion: pattern.engineVersion,
    status: pattern.status,
  }));

  const plan = planReverifySweep(sweepable);
  if (plan.changes.length === 0) return ok(reportOf([], plan.examined));

  const db = getAdminDb();
  const batch = db.batch();
  for (const change of plan.changes) {
    batch.update(db.collection(PATTERNS_COLLECTION).doc(change.id), { status: change.status });
  }
  await batch.commit();

  countWrites(
    plan.changes.map(() => ({ collection: PATTERNS_COLLECTION, operation: "update" as const })),
  );

  return ok(reportOf(plan.changes, plan.examined));
}
