/**
 * Deterministic `failurePatterns` document ID, derived from the fields that
 * define a distinct pattern (`encodingId`, `engineVersion`, `failedSequence`).
 * Using a content hash as the doc ID — instead of reading-then-writing to
 * find an existing pattern — means concurrent occurrences of the same
 * failure upsert the same document without a race or a duplicate.
 *
 * Server-only: unlike `features/converter/engine/version.ts`'s
 * `computeRulesHash` (which must be browser-safe because `pipeline.ts` runs
 * client-side too), this module is only ever imported from
 * `lib/firebase/conversionFailures.ts` and API routes, so Node's `crypto` is
 * safe to use here.
 */
import { createHash } from "crypto";

export function computeFailurePatternId(input: {
  encodingId: string | null;
  engineVersion: string;
  failedSequence: string;
}): string {
  const key = `${input.encodingId ?? ""}|${input.engineVersion}|${input.failedSequence}`;
  return createHash("sha256").update(key, "utf8").digest("hex");
}
