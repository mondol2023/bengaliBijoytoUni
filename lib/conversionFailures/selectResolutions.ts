/**
 * Which stored resolutions become published ones, in what order, and how
 * many.
 *
 * Phase 4 item 5. Three properties this module exists to hold:
 *
 * **Nothing is served that a human did not accept**, unless someone set
 * `SERVE_UNVERIFIED_AI` on purpose — and then every unreviewed entry is
 * labelled.
 *
 * **The validator runs again here.** It already ran before storing
 * (`lib/ai/resolveConversionFailure.ts`), but an `accepted` flag records a
 * judgement someone made at some past moment, against rule tables and an
 * engine that have since moved. The second run is what makes an acceptance
 * expire on its own rather than outlive its correctness.
 *
 * **Selection is a pure function.** Ordering, the top-N cut and the byte cap
 * are decided here, with no Firestore and no request in scope, so the
 * question "what would we publish given these documents" is answerable in a
 * test without a database.
 *
 * On ranking: `hitCount` is incremented only when an *accepted* resolution is
 * served, so unlike `occurrenceCount` it is not anonymous-writable — an
 * attacker cannot push their own text up this ordering without an admin
 * accepting it first (`docs/threat-model-public-failure-endpoints.md` §2).
 */
import { validateCandidateResolution } from "./resolutionValidator";
import {
  AI_UNVERIFIED_LABEL,
  KNOWN_RESOLUTIONS_DEFAULT_LIMIT,
  KNOWN_RESOLUTIONS_MAX_BYTES,
  type KnownResolution,
  type StoredResolution,
} from "./knownResolutions";

export interface SelectServableResolutionsOptions {
  readonly resolutions: readonly StoredResolution[];
  /** `isServeUnverifiedAiEnabled()` at the moment the snapshot is built. */
  readonly serveUnverified: boolean;
  readonly limit?: number;
  readonly maxBytes?: number;
}

const encoder = new TextEncoder();

function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/**
 * Most-used first. `lastUsedAt` breaks a tie on count, and `lookupKey` breaks
 * a tie on both — without that last step two equally-unused resolutions could
 * swap places between builds and change the ETag for no reason.
 */
function byUsefulness(a: StoredResolution, b: StoredResolution): number {
  if (a.hitCount !== b.hitCount) return b.hitCount - a.hitCount;
  const aUsed = a.lastUsedAt ?? "";
  const bUsed = b.lastUsedAt ?? "";
  if (aUsed !== bUsed) return aUsed < bUsed ? 1 : -1;
  return a.lookupKey < b.lookupKey ? -1 : a.lookupKey > b.lookupKey ? 1 : 0;
}

/** Whether this record may be published at all, before the validator gets a say. */
function isServable(resolution: StoredResolution, serveUnverified: boolean): boolean {
  if (resolution.reviewDecision === "rejected") return false;
  if (resolution.reviewDecision === "accepted") return true;
  // Everything else is unverified. `completed` is the only unverified state
  // that ever holds a candidate somebody might want: `pending` has none yet
  // and `failed` is either a provider error or a validator rejection.
  return serveUnverified && resolution.status === "completed";
}

export function selectServableResolutions(
  options: SelectServableResolutionsOptions,
): KnownResolution[] {
  const limit = options.limit ?? KNOWN_RESOLUTIONS_DEFAULT_LIMIT;
  const maxBytes = options.maxBytes ?? KNOWN_RESOLUTIONS_MAX_BYTES;

  const eligible = options.resolutions
    .filter((resolution) => {
      if (resolution.candidateConversion === null || resolution.candidateConversion.length === 0) {
        return false;
      }
      if (!isServable(resolution, options.serveUnverified)) return false;
      // The second run. A record with no `encodingId` has no table to check
      // against and is dropped by the validator itself, not by a check here.
      return validateCandidateResolution({
        encodingId: resolution.encodingId ?? "",
        failedSequence: resolution.failedSequence,
        candidateConversion: resolution.candidateConversion,
      }).valid;
    })
    .sort(byUsefulness)
    .slice(0, limit);

  const published: KnownResolution[] = [];
  let bytes = 0;
  for (const resolution of eligible) {
    const accepted = resolution.reviewDecision === "accepted";
    const entry: KnownResolution = {
      failedSequence: resolution.failedSequence,
      // Non-null: the filter above dropped every record without one.
      candidateConversion: resolution.candidateConversion as string,
      verification: accepted ? "accepted" : "unverified",
      label: accepted ? null : AI_UNVERIFIED_LABEL,
      engineVersion: resolution.engineVersion,
    };
    const size = byteLength(entry);
    if (bytes + size > maxBytes) break;
    bytes += size;
    published.push(entry);
  }
  return published;
}
