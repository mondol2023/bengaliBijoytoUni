/**
 * Which stored patterns and resolutions the public snapshot may carry, decided
 * from each pattern's **current** stored status at the moment the snapshot is
 * built.
 *
 * Closes finding 2 of `docs/threat-model-public-failure-endpoints.md`, and
 * answers open question 3 of `docs/phase-5-conversion-with-fallback.md`
 * ("keep the resolution, stop publishing it"), with one rule:
 *
 * **Only an `open` pattern justifies publishing.** `open` is the server's own
 * verdict that the current engine still fails on the sequence
 * (`./reverify.ts`). A pattern re-verification has marked `resolved` is no
 * longer a gap — the engine now converts it, and runs first anyway — so it,
 * and any resolution that was filling it, stops being published.
 *
 * ## Derived, never stored
 *
 * Nothing here writes. There is no "superseded" or "retired" field on a
 * pattern or a resolution: the status the sweep and the occurrence-time
 * correction already maintain is the whole input. So the moment a status
 * changes, the next snapshot build reflects it, and there is no second flag
 * to fall out of step with the first.
 *
 * ## Fails closed
 *
 * A resolution whose provenance pattern cannot be found — deleted by its
 * 365-day sliding retention (`./retention.ts`), or never written — has no
 * stored status, so nothing justifies publishing it. It is kept, not
 * deleted; it is simply not served. The accepted record is the history of
 * how the gap was closed, and `docs/data-retention.md` keeps it for good.
 */

export type PatternStatus = "open" | "resolved";

/** The one status that justifies publishing. */
export function isPublishableStatus(status: PatternStatus | undefined): boolean {
  return status === "open";
}

/** Drops every pattern whose stored status does not justify publishing. Order is kept. */
export function publishablePatterns<T extends { readonly status: PatternStatus }>(
  patterns: readonly T[],
): T[] {
  return patterns.filter((pattern) => isPublishableStatus(pattern.status));
}

/**
 * Drops every resolution whose provenance pattern is not currently `open`,
 * including one whose pattern is missing from `statusByPatternId`.
 */
export function publishableResolutions<T extends { readonly patternId: string }>(
  resolutions: readonly T[],
  statusByPatternId: ReadonlyMap<string, PatternStatus>,
): T[] {
  return resolutions.filter((resolution) =>
    isPublishableStatus(statusByPatternId.get(resolution.patternId)),
  );
}
