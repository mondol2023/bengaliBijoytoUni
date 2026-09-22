/**
 * The three statuses Phase 4 serves on: `unverified | accepted | rejected`.
 *
 * Derived, not stored. `aiResolutions` already carries `status`
 * (`pending|completed|failed|reviewed`) and `reviewDecision`
 * (`accepted|rejected|null`), and `lib/ai/reviewConversionResolution.ts`
 * runs a state machine over both. Adding a third status field would mean
 * two sources of truth for the same question and a write that can half-fail
 * between them. One function reads the pair instead.
 *
 * Only `reviewDecision` can produce `accepted`, and only the admin review
 * path writes `reviewDecision` — so "only a human promotes a resolution" is
 * a property of where the field is written, not a rule this module enforces.
 * `__tests__/resolutionStatus.test.ts` asserts the second half by scanning
 * for other writers.
 *
 * Lives outside `lib/ai` on purpose: the serving side needs this and must
 * not import `lib/ai` (the boundary asserted by
 * `lib/ai/__tests__/callSites.test.ts`).
 */

export const RESOLUTION_STATUSES = ["unverified", "accepted", "rejected"] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

/** The fields this derivation reads — a structural subset of `AiResolution`. */
export interface ReviewableResolution {
  readonly status: "pending" | "completed" | "failed" | "reviewed";
  readonly reviewDecision: "accepted" | "rejected" | null;
}

/**
 * Anything that is not an explicit human decision is `unverified`, including
 * `failed` and `pending`. That is the conservative direction: the only
 * status that unlocks serving is the one a person had to create.
 */
export function resolutionStatusOf(resolution: ReviewableResolution): ResolutionStatus {
  if (resolution.reviewDecision === "accepted") return "accepted";
  if (resolution.reviewDecision === "rejected") return "rejected";
  return "unverified";
}

/** Convenience for the serving filter, which only ever wants one of the three. */
export function isAcceptedResolution(resolution: ReviewableResolution): boolean {
  return resolutionStatusOf(resolution) === "accepted";
}
