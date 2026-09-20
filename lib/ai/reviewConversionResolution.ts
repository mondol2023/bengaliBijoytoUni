/**
 * Phase 7 — the human review layer over Phase 6's `aiResolutions` records. See
 * `docs/conversion-failure-pipeline.md` §7.4 for the full flow. Like
 * `resolveConversionFailure.ts`, this is the only `lib/ai/*` module (besides
 * that one) that imports `lib/firebase/*`; the review workflow never reaches
 * into the provider layer at all.
 *
 * The state machine deliberately reuses the existing `aiResolutions.status`/
 * `reviewDecision` fields (`lib/firebase/schemas.ts`) rather than inventing a
 * parallel one:
 *
 *   status: "completed", reviewDecision: null       → pending review
 *   status: "reviewed",  reviewDecision: "accepted" → accepted (terminal)
 *   status: "reviewed",  reviewDecision: "rejected" → rejected (terminal)
 *   status: "pending" | "failed"                    → not yet reviewable
 *
 * Accepting or rejecting only ever sets `status`/`reviewDecision`/`reviewedBy`/
 * `reviewedAt`/`reviewNote` — every other field (`candidateConversion`,
 * `provider`, `model`, `promptVersion`, `engineVersion`, `rulesHash`,
 * `confidence`, ...) is carried through unchanged. A human review records that
 * an admin looked at an AI candidate and made a call; it never patches engine
 * rules and never touches `features/converter/engine/**`.
 */
import { assertServerOnly } from "./assertServerOnly";

assertServerOnly("lib/ai/reviewConversionResolution.ts");

import { getAdminDb } from "../firebase/admin";
import { aiResolutionSchema, type AiResolution } from "../firebase/schemas";
import { getFailurePatternById, type WithId } from "../firebase/conversionFailures";
import { AppErrors, type Result } from "../errors/types";

const AI_RESOLUTIONS_COLLECTION = "aiResolutions";

/** Matches `aiResolutionSchema.reviewDecision` exactly — a compile error here means the schema moved and this must follow. */
export const REVIEW_DECISIONS = ["accepted", "rejected"] as const satisfies readonly NonNullable<
  AiResolution["reviewDecision"]
>[];
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export interface ReviewConversionResolutionInput {
  readonly patternId: string;
  readonly resolutionId: string;
  readonly decision: ReviewDecision;
  /** The authenticated admin's uid — the route derives this from `requireAdminUser`, never from the request body. */
  readonly reviewedBy: string;
  readonly reviewNote?: string | null;
}

export interface ReviewConversionResolutionOutput {
  readonly resolution: WithId<AiResolution>;
  /** True when a terminal state was re-submitted with the *same* decision and returned as-is rather than re-written (§ idempotency). */
  readonly alreadyReviewed: boolean;
}

type ReviewState = "pending_review" | "accepted" | "rejected" | "not_reviewable";

function deriveReviewState(resolution: Pick<AiResolution, "status" | "reviewDecision">): ReviewState {
  if (resolution.status === "completed") return "pending_review";
  if (resolution.status === "reviewed" && resolution.reviewDecision === "accepted") return "accepted";
  if (resolution.status === "reviewed" && resolution.reviewDecision === "rejected") return "rejected";
  // "pending" (never resolved), "failed" (no usable candidate), or a malformed
  // "reviewed"-without-decision record — none are reviewable.
  return "not_reviewable";
}

type ReviewOutcome =
  | { readonly state: "not_found" }
  | { readonly state: "not_reviewable" }
  | { readonly state: "conflict" }
  | { readonly state: "updated"; readonly resolution: WithId<AiResolution> }
  | { readonly state: "idempotent"; readonly resolution: WithId<AiResolution> };

/**
 * The entire concurrency mechanism (§ step 8): reads the current document,
 * confirms it's still in a state this decision can apply to, and writes the
 * review atomically. Two admins racing the same pending resolution can both
 * enter this transaction, but only the first commit sees `pending_review` —
 * Firestore's transaction retry serializes the rest, so the second either
 * lands on `idempotent` (same decision) or `conflict` (different decision),
 * never a silent overwrite.
 */
async function applyReviewTransaction(
  docRef: FirebaseFirestore.DocumentReference,
  input: ReviewConversionResolutionInput,
): Promise<ReviewOutcome> {
  const db = getAdminDb();
  return db.runTransaction(async (tx): Promise<ReviewOutcome> => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return { state: "not_found" };

    const parsed = aiResolutionSchema.safeParse(snap.data());
    if (!parsed.success) return { state: "not_found" };

    const resolution = parsed.data;
    // A resolutionId that exists but belongs to a different pattern must fail
    // exactly like "not found" — never confirm that it exists elsewhere.
    if (resolution.patternId !== input.patternId) return { state: "not_found" };

    const reviewState = deriveReviewState(resolution);

    if (reviewState === "pending_review") {
      const updated: AiResolution = {
        ...resolution,
        status: "reviewed",
        reviewDecision: input.decision,
        reviewedBy: input.reviewedBy,
        reviewedAt: new Date().toISOString(),
        reviewNote: input.reviewNote ?? null,
      };
      const validated = aiResolutionSchema.parse(updated);
      tx.set(docRef, validated);
      return { state: "updated", resolution: { id: snap.id, ...validated } };
    }

    if (reviewState === "accepted" || reviewState === "rejected") {
      if (reviewState === input.decision) {
        return { state: "idempotent", resolution: { id: snap.id, ...resolution } };
      }
      return { state: "conflict" };
    }

    return { state: "not_reviewable" };
  });
}

/**
 * Orchestrates one admin accept/reject decision end to end. Returns a
 * `Result` so the API route can map failures to HTTP status without
 * re-deriving what went wrong (mirrors `resolveConversionFailure`).
 */
export async function reviewConversionResolution(
  input: ReviewConversionResolutionInput,
): Promise<Result<ReviewConversionResolutionOutput>> {
  // Only an existence check — this workflow never reads occurrence data, so
  // `getFailurePatternById` avoids pulling up to 20 full-text occurrence
  // documents just to confirm the pattern is real.
  let pattern;
  try {
    pattern = await getFailurePatternById(input.patternId);
  } catch (cause) {
    return { ok: false, error: AppErrors.database("Could not load the stored failure pattern.", { debug: cause }) };
  }
  if (!pattern) {
    return { ok: false, error: AppErrors.notFound(`No failure pattern "${input.patternId}" was found.`) };
  }

  const docRef = getAdminDb().collection(AI_RESOLUTIONS_COLLECTION).doc(input.resolutionId);

  let outcome: ReviewOutcome;
  try {
    outcome = await applyReviewTransaction(docRef, input);
  } catch (cause) {
    return { ok: false, error: AppErrors.database("Could not update the AI resolution review.", { debug: cause }) };
  }

  switch (outcome.state) {
    case "not_found":
      return {
        ok: false,
        error: AppErrors.notFound(`No AI resolution "${input.resolutionId}" was found for this failure pattern.`),
      };
    case "not_reviewable":
      return {
        ok: false,
        error: AppErrors.conflict("This AI resolution has no reviewable candidate yet."),
      };
    case "conflict":
      return {
        ok: false,
        error: AppErrors.conflict("This AI resolution was already reviewed with a different decision."),
      };
    case "updated":
      return { ok: true, value: { resolution: outcome.resolution, alreadyReviewed: false } };
    case "idempotent":
      return { ok: true, value: { resolution: outcome.resolution, alreadyReviewed: true } };
  }
}
