/**
 * Phase 6 — the only place that turns a stored `FailurePattern` into a real
 * AI-provider call and persists the outcome. See
 * `docs/conversion-failure-pipeline.md` §7.2 for the full flow. Everything
 * upstream of this file (`lib/ai/types.ts`, `registry.ts`, `providers/*.ts`)
 * is Firestore-independent by design (Phase 5); this file is where that
 * provider-agnostic library meets persistence, and it is the only `lib/ai/*`
 * module that imports `lib/firebase/*`.
 *
 * Callers (the API route) never build a `ConversionResolutionRequest`
 * themselves and never pass failure content in the request body — this
 * service loads the authoritative `FailurePattern` (+ its most recent
 * occurrence) from Firestore and builds the request itself, so a client can
 * only choose *which* pattern/provider, never *what* gets sent.
 */
import { createHash } from "crypto";
import { assertServerOnly } from "./assertServerOnly";

assertServerOnly("lib/ai/resolveConversionFailure.ts");

import { getAdminDb } from "../firebase/admin";
import {
  aiResolutionSchema,
  type AiResolution,
  type FailurePattern,
  type ConversionFailure,
} from "../firebase/schemas";
import { getFailurePatternDetail, codePointsOf, type WithId } from "../firebase/conversionFailures";
import { getResolutionProvider } from "./registry";
import { CONVERSION_RESOLUTION_PROMPT_VERSION } from "./promptBuilder";
import { mapResolutionConfidence } from "./confidenceMapping";
import { RESOLUTION_LIMITS } from "./limits";
import { computeResolutionLookupKey } from "../conversionFailures/resolutionLookup";
import {
  summarizeRejections,
  validateCandidateResolution,
} from "../conversionFailures/resolutionValidator";
import { createDailyCallBudget } from "./costCap";
import { firestoreCounterStore } from "@/lib/firebase/sharedCounter";
import { createInFlightMap } from "./inFlight";
import { withProviderRetry } from "./retry";
import type { ConversionResolutionRequest, ProviderId, ResolutionOptions } from "./types";
import type { ProviderError } from "./errors";
import { AppErrors, type AppError, type Result } from "../errors/types";
import { logAppError } from "../errors/handlers";

/**
 * The deployment-wide daily call budget. Its count is a Firestore document
 * per UTC day rather than module memory, because on Vercel every instance
 * would otherwise hold its own budget (`lib/ai/costCap.ts`).
 */
const dailyCallBudget = createDailyCallBudget({ store: firestoreCounterStore });

const AI_RESOLUTIONS_COLLECTION = "aiResolutions";

/**
 * One attempt per resolution key at a time, in this process. The Firestore
 * claim below already stops two processes paying twice; this stops an admin
 * double-clicking from turning a request that was about to succeed into a
 * 409 for themselves. See `lib/ai/inFlight.ts`.
 */
const inFlight = createInFlightMap<Result<ResolveConversionFailureOutput>>();

export interface ResolveConversionFailureInput {
  readonly patternId: string;
  readonly providerId: ProviderId;
  /** Server-validated privacy opt-ins — never trust a client value beyond what the route's zod schema already accepted. */
  readonly includeContext: boolean;
  readonly includeFullText: boolean;
}

export interface ResolveConversionFailureOutput {
  readonly resolution: WithId<AiResolution>;
  /** True when an existing completed resolution was returned instead of calling the provider again (§16 dedup). */
  readonly reused: boolean;
}

/**
 * Deterministic `aiResolutions` doc ID — the *entire* dedup/concurrency
 * mechanism (§16/§17 of the phase spec), mirroring
 * `lib/conversionFailures/patternId.ts`'s existing pattern of using a content
 * hash as a doc ID instead of a read-then-write lookup. Two resolutions are
 * "the same" exactly when every one of these six fields matches; changing
 * any of them (a new provider, a reconfigured model, a bumped prompt
 * version, a new engine version, or a rules-hash drift) produces a different
 * key, so an incompatible resolution is never reused — it naturally lives at
 * a different document.
 */
export function computeResolutionKey(input: {
  patternId: string;
  provider: ProviderId;
  model: string;
  promptVersion: string;
  engineVersion: string;
  rulesHash: string | null;
}): string {
  const key = [
    input.patternId,
    input.provider,
    input.model,
    input.promptVersion,
    input.engineVersion,
    input.rulesHash ?? "",
  ].join("|");
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Maps a Phase 5 `ProviderError` to the app-wide safe error model (§19) — never a generic 500 where a more precise status exists, never `debug`/API-key material leaking into the response. */
function mapProviderErrorToAppError(error: ProviderError): AppError {
  switch (error.code) {
    case "provider_rate_limited":
      return AppErrors.rateLimit(error.message, { details: { retryAfterSeconds: error.retryAfterSeconds ?? 60 } });
    case "provider_not_registered":
    case "provider_content_rejected":
      return AppErrors.validation(error.message);
    // 404, not 500: the deployment-wide switch being off is a deliberate
    // configuration, not a fault, and the endpoint genuinely offers nothing
    // here. It also keeps a disabled deployment from confirming which
    // providers exist, matching the check's placement in `registry.ts`.
    case "provider_disabled":
      return AppErrors.notFound(error.message);
    // 429 with the other throttles: an admin who waits gets served, which is
    // what a rate-limit status means and what the UI already handles.
    case "provider_budget_exhausted":
      return AppErrors.rateLimit(error.message, { details: { retryAfterSeconds: 3_600 } });
    case "provider_budget_unavailable":
    case "provider_not_configured":
    case "provider_authentication_failed":
    case "provider_timeout":
    case "provider_unavailable":
    case "provider_invalid_response":
    case "provider_unknown_error":
      return AppErrors.unknown(error.message, { debug: error.debug });
  }
}

/**
 * Picks the one occurrence used for occurrence-level fields (`rulesHash`,
 * `contextBefore`/`contextAfter`, `fullText`, `position`, `engineOutput`) —
 * everything a `FailurePattern` itself doesn't carry (§4). `occurrences` is
 * already ordered most-recent-first by `getFailurePatternDetail`, so the
 * chosen occurrence is always the one that best reflects the pattern's
 * *current* `lastSeenAt` state, not an arbitrary sample — important because
 * two occurrences of the same pattern can in principle carry a different
 * `rulesHash` (a rules edit that didn't bump `engineVersion`) or different
 * context.
 */
function pickRepresentativeOccurrence(occurrences: WithId<ConversionFailure>[]): WithId<ConversionFailure> | null {
  return occurrences[0] ?? null;
}

function buildResolutionRequest(
  pattern: FailurePattern,
  occurrence: WithId<ConversionFailure>,
  options: ResolveConversionFailureInput,
): ConversionResolutionRequest {
  return {
    failurePatternId: options.patternId,
    encodingId: pattern.encodingId,
    failedSequence: pattern.failedSequence,
    codePoints: codePointsOf(pattern.failedSequence),
    contextBefore: options.includeContext ? occurrence.contextBefore : undefined,
    contextAfter: options.includeContext ? occurrence.contextAfter : undefined,
    fullText: options.includeFullText ? occurrence.fullText : undefined,
    position: occurrence.position,
    currentEngineOutput: occurrence.engineOutput,
    failureCategory: pattern.failureCategory,
    engineVersion: pattern.engineVersion,
    rulesHash: occurrence.rulesHash,
  };
}

/**
 * Usage counters carried across a reclaim. Reclaiming rewrites the whole
 * document with `set`, which would otherwise reset `hitCount` to zero — and
 * a resolution that has been served a thousand times losing its rank because
 * someone re-ran the resolver is a silent regression in what gets published.
 */
interface CarriedCounters {
  readonly hitCount: number;
  readonly lastUsedAt: string | null;
}

const FRESH_COUNTERS: CarriedCounters = { hitCount: 0, lastUsedAt: null };

type ClaimResult =
  | { readonly state: "claimed"; readonly carried: CarriedCounters }
  | { readonly state: "reused"; readonly resolution: WithId<AiResolution> }
  | { readonly state: "conflict" };

/**
 * Atomically claims the deterministic resolution slot before ever calling a
 * provider (§17). A slot is claimable when it doesn't exist yet, holds a
 * malformed/legacy document, holds a `"failed"` result (a previous attempt
 * that's safe to retry), or holds a `"pending"` claim old enough
 * (`RESOLUTION_LIMITS.pendingClaimTimeoutMs`) to be treated as abandoned —
 * e.g. a server crashed between claiming and writing the final result.
 * A fresh `"pending"` claim from a concurrent request is the one case that
 * is *not* claimable — that caller gets a `409 CONFLICT_ERROR` instead of
 * triggering a second paid provider call for the same key.
 */
async function claimResolutionSlot(
  docRef: FirebaseFirestore.DocumentReference,
  pendingRecord: AiResolution,
): Promise<ClaimResult> {
  const db = getAdminDb();
  return db.runTransaction(async (tx): Promise<ClaimResult> => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      tx.set(docRef, aiResolutionSchema.parse(pendingRecord));
      return { state: "claimed", carried: FRESH_COUNTERS };
    }

    const parsed = aiResolutionSchema.safeParse(snap.data());
    if (!parsed.success) {
      // Malformed/legacy record — never crash the API over it (§22); reclaim and retry.
      // No counters carried: nothing in an unparseable document is trustworthy.
      tx.set(docRef, aiResolutionSchema.parse(pendingRecord));
      return { state: "claimed", carried: FRESH_COUNTERS };
    }

    const carried: CarriedCounters = {
      hitCount: parsed.data.hitCount,
      lastUsedAt: parsed.data.lastUsedAt,
    };
    const reclaimed = { ...pendingRecord, ...carried };

    if (parsed.data.status === "completed") {
      return { state: "reused", resolution: { id: snap.id, ...parsed.data } };
    }

    if (parsed.data.status === "pending") {
      const ageMs = Date.now() - new Date(parsed.data.createdAt).getTime();
      if (ageMs > RESOLUTION_LIMITS.pendingClaimTimeoutMs) {
        tx.set(docRef, aiResolutionSchema.parse(reclaimed));
        return { state: "claimed", carried };
      }
      return { state: "conflict" };
    }

    // "failed" (or a future "reviewed") — not a completed success, safe to retry.
    tx.set(docRef, aiResolutionSchema.parse(reclaimed));
    return { state: "claimed", carried };
  });
}

/**
 * Orchestrates one admin-triggered resolution attempt end to end (§ objective
 * flow). Returns a `Result` so the API route can map failures to HTTP status
 * without re-deriving what went wrong.
 */
export async function resolveConversionFailure(
  input: ResolveConversionFailureInput,
): Promise<Result<ResolveConversionFailureOutput>> {
  // Keyed on everything that makes two attempts the same attempt — the same
  // six fields as the Firestore document id, minus the two (`engineVersion`,
  // `rulesHash`) that are only known after the pattern is read. Two requests
  // that agree on these and are in flight together are the same request.
  const key = [input.patternId, input.providerId, input.includeContext, input.includeFullText].join("|");
  return inFlight.run(key, () => runResolution(input));
}

async function runResolution(
  input: ResolveConversionFailureInput,
): Promise<Result<ResolveConversionFailureOutput>> {
  const providerResult = getResolutionProvider(input.providerId);
  if (!providerResult.ok) {
    return { ok: false, error: mapProviderErrorToAppError(providerResult.error) };
  }
  const provider = providerResult.value;

  let detail;
  try {
    detail = await getFailurePatternDetail(input.patternId);
  } catch (cause) {
    return { ok: false, error: AppErrors.database("Could not load the stored failure pattern.", { debug: cause }) };
  }
  if (!detail) {
    return { ok: false, error: AppErrors.notFound(`No failure pattern "${input.patternId}" was found.`) };
  }

  const occurrence = pickRepresentativeOccurrence(detail.occurrences);
  if (!occurrence) {
    return {
      ok: false,
      error: AppErrors.database(
        `Failure pattern "${input.patternId}" has no occurrence records to resolve from — its stored data is incomplete.`,
      ),
    };
  }

  const pattern = detail.pattern;
  const request = buildResolutionRequest(pattern, occurrence, input);
  const options: ResolutionOptions = { includeContext: input.includeContext, includeFullText: input.includeFullText };

  const resolutionKey = computeResolutionKey({
    patternId: input.patternId,
    provider: provider.id,
    model: provider.model,
    promptVersion: CONVERSION_RESOLUTION_PROMPT_VERSION,
    engineVersion: pattern.engineVersion,
    rulesHash: occurrence.rulesHash,
  });
  const docRef = getAdminDb().collection(AI_RESOLUTIONS_COLLECTION).doc(resolutionKey);
  const now = new Date().toISOString();

  const pendingRecord: AiResolution = {
    patternId: input.patternId,
    // Copied from the authoritative pattern, not from anything the caller
    // sent, and hashed here so serving needs one equality query rather than
    // a join back through `patternId`.
    encodingId: pattern.encodingId,
    failedSequence: pattern.failedSequence,
    lookupKey: computeResolutionLookupKey({
      encodingId: pattern.encodingId,
      failedSequence: pattern.failedSequence,
    }),
    provider: provider.id,
    model: provider.model,
    promptVersion: CONVERSION_RESOLUTION_PROMPT_VERSION,
    engineVersion: pattern.engineVersion,
    rulesHash: occurrence.rulesHash,
    candidateConversion: null,
    reasoningSummary: null,
    confidence: "unknown",
    alternativeCandidates: [],
    isCertain: false,
    rawResponse: null,
    status: "pending",
    // A new record has been served zero times. Both are written explicitly
    // rather than left to the schema default, so the stored document has
    // the field from the start and the first increment has something to
    // add to.
    hitCount: 0,
    lastUsedAt: null,
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: now,
  };

  let claim: ClaimResult;
  try {
    claim = await claimResolutionSlot(docRef, pendingRecord);
  } catch (cause) {
    return { ok: false, error: AppErrors.database("Could not claim a resolution slot.", { debug: cause }) };
  }

  if (claim.state === "reused") {
    return { ok: true, value: { resolution: claim.resolution, reused: true } };
  }
  if (claim.state === "conflict") {
    return {
      ok: false,
      error: AppErrors.conflict("A resolution for this exact pattern/provider/model is already in progress."),
    };
  }

  // Reserved after the slot is claimed, so a request refused as a duplicate
  // or returned from an existing completed resolution never spends a unit —
  // those paths return above this line. From here the call always happens,
  // which is why nothing releases the reservation: a provider call that
  // failed still consumed a request.
  const reservation = await dailyCallBudget.reserve();
  if (!reservation.ok) {
    return { ok: false, error: mapProviderErrorToAppError(reservation.error) };
  }

  // Retries are bounded and only for failures that are about the moment
  // rather than about the request (`lib/ai/retry.ts`). They share the one
  // reserved unit deliberately: a retry is the same call, not a new one, and
  // charging for each attempt would make a flaky network eat the day's
  // budget.
  const providerCallResult = await withProviderRetry(() => provider.resolve(request, options));

  if (!providerCallResult.ok) {
    const failedRecord: AiResolution = {
      ...pendingRecord,
      ...claim.carried,
      status: "failed",
      // No dedicated error-code field exists on `aiResolutionSchema` (§14) — reusing
      // `reasoningSummary` for a short, safe code is preferred over inventing a duplicate field.
      // Never `error.debug` or raw provider text here.
      reasoningSummary: `Resolution failed: ${providerCallResult.error.code}`,
      createdAt: now,
    };
    try {
      await docRef.set(aiResolutionSchema.parse(failedRecord));
    } catch (cause) {
      logAppError(
        { code: "DATABASE_ERROR", message: "Failed to persist a failed AI resolution record.", debug: cause },
        { route: "lib/ai/resolveConversionFailure", patternId: input.patternId },
      );
    }
    return { ok: false, error: mapProviderErrorToAppError(providerCallResult.error) };
  }

  const resolution = providerCallResult.value;

  // The first of the validator's two runs (Phase 4 item 4; the second is on
  // the serving side). A candidate that cannot pass is not stored as a
  // candidate at all: leaving it `completed` would put it in the admin review
  // queue, and the whole point of the queue is that a human reading it is the
  // last check, not the first. Only the rejection *codes* are persisted —
  // never the provider text that failed, which is the same rule the failed
  // path above follows.
  //
  // `candidateConversion: null` is a provider saying "I don't know", which is
  // a legitimate completed record and not something to validate. A pattern
  // with no `encodingId` fails closed instead: there is no rule table to
  // check the output against, so there is no way to store it honestly.
  const validation =
    resolution.candidateConversion === null
      ? null
      : validateCandidateResolution({
          encodingId: pattern.encodingId ?? "",
          failedSequence: pattern.failedSequence,
          candidateConversion: resolution.candidateConversion,
        });
  if (validation && !validation.valid) {
    const rejectedRecord: AiResolution = {
      ...pendingRecord,
      ...claim.carried,
      status: "failed",
      reasoningSummary: `Candidate rejected by the validator: ${summarizeRejections(validation)}`,
      createdAt: now,
    };
    try {
      await docRef.set(aiResolutionSchema.parse(rejectedRecord));
    } catch (cause) {
      logAppError(
        { code: "DATABASE_ERROR", message: "Failed to persist a rejected AI resolution record.", debug: cause },
        { route: "lib/ai/resolveConversionFailure", patternId: input.patternId },
      );
    }
    return {
      ok: false,
      error: AppErrors.conversion(
        "The AI produced a candidate conversion that failed validation, so it was not stored.",
        { debug: { rejections: validation.rejections } },
      ),
    };
  }

  const completedRecord: AiResolution = {
    patternId: input.patternId,
    // From the claim, not from `pendingRecord`: a reclaimed slot may already
    // have been served, and `set` would otherwise zero that history.
    hitCount: claim.carried.hitCount,
    lastUsedAt: claim.carried.lastUsedAt,
    encodingId: pendingRecord.encodingId,
    failedSequence: pendingRecord.failedSequence,
    lookupKey: pendingRecord.lookupKey,
    provider: provider.id,
    model: provider.model,
    promptVersion: resolution.promptVersion,
    engineVersion: resolution.engineVersion,
    rulesHash: resolution.rulesHash,
    candidateConversion: resolution.candidateConversion,
    reasoningSummary: resolution.explanation,
    confidence: mapResolutionConfidence(resolution.confidence),
    alternativeCandidates: resolution.alternatives,
    isCertain: resolution.isCertain,
    // Phase 5/6 policy (docs §15): never persist raw provider response bodies.
    rawResponse: null,
    status: "completed",
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: now,
  };

  try {
    const validated = aiResolutionSchema.parse(completedRecord);
    await docRef.set(validated);
    return { ok: true, value: { resolution: { id: docRef.id, ...validated }, reused: false } };
  } catch (cause) {
    // The AI call itself succeeded — this is a distinct failure mode from a
    // provider error (§20) and must never be reported as a success.
    return {
      ok: false,
      error: AppErrors.database(
        "The AI provider produced a result, but it could not be saved. Please try again.",
        { debug: cause },
      ),
    };
  }
}
