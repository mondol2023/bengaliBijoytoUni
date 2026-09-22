/**
 * The known-patterns snapshot: the shape the server publishes and the client
 * caches, plus the one function that decides what a pattern document is
 * allowed to become on the wire.
 *
 * ## Why this is a separate, tiny module
 *
 * `FailurePattern` carries `occurrenceCount`, `firstSeenAt`, `lastSeenAt` and
 * `sampleOccurrenceIds` — Firestore document ids of individual user
 * occurrences. None of that may leave the server on a publicly readable
 * endpoint. Redaction by omission ("just don't spread the object") is the
 * kind of rule that survives exactly until someone writes `...pattern` in a
 * hurry. `toKnownPattern` is an explicit three-field construction, and
 * `__tests__/knownPatterns.test.ts` asserts the result has exactly those
 * three keys, so adding a field to `FailurePattern` cannot leak it here.
 *
 * ## What it is for, and what it is not for
 *
 * It tells the UI which failed sequences are already known, so a user can be
 * told "this is a known gap, already recorded" instead of being shown a raw
 * warning. It is **not** an input to whether a failure gets reported.
 * Suppressing a report because the pattern is already known would bias
 * `occurrenceCount`, which is the number Phase 5 would prioritize work from.
 */
import { z } from "zod";
import { FAILURE_CATEGORIES } from "@/features/converter/engine/classify";
import { knownResolutionSchema } from "./knownResolutions";

/** The whole public payload for one pattern. Three fields, by design. */
export const knownPatternSchema = z.object({
  failedSequence: z.string().min(1),
  failureCategory: z.enum(FAILURE_CATEGORIES),
  status: z.enum(["open", "resolved"]),
});
export type KnownPattern = z.infer<typeof knownPatternSchema>;

export const knownPatternsSnapshotSchema = z.object({
  encodingId: z.string().nullable(),
  engineVersion: z.string().min(1),
  /** Ordered most-frequent-first. The counts themselves are not published. */
  patterns: z.array(knownPatternSchema),
  /**
   * Accepted resolutions for this encoding, most-used first
   * (`./knownResolutions.ts`). Defaulted so a snapshot written before this
   * field existed — one sitting in a browser cache right now — still parses
   * rather than being thrown away as invalid.
   */
  resolutions: z.array(knownResolutionSchema).default([]),
  /** When the server built this snapshot. Deliberately excluded from the ETag. */
  generatedAt: z.string(),
});
export type KnownPatternsSnapshot = z.infer<typeof knownPatternsSnapshotSchema>;

/** Default and ceiling for `?limit=`. */
export const KNOWN_PATTERNS_DEFAULT_LIMIT = 50;
export const KNOWN_PATTERNS_MAX_LIMIT = 200;

/**
 * The only way a stored pattern becomes a published one. Named fields, never
 * a spread: the point is that this breaks visibly if the source type grows a
 * field, rather than quietly forwarding it.
 */
export function toKnownPattern(pattern: {
  failedSequence: string;
  failureCategory: KnownPattern["failureCategory"];
  status: KnownPattern["status"];
}): KnownPattern {
  return {
    failedSequence: pattern.failedSequence,
    failureCategory: pattern.failureCategory,
    status: pattern.status,
  };
}
