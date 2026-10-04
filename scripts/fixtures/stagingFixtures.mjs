/**
 * The synthetic staging data the Stage 1 Preview canary needs, and nothing
 * else (docs/staging-environment.md §6). Written only by
 * `scripts/stagingFirebase.mjs seed`, which refuses any project but staging.
 *
 * One accepted fallback resolution, so the canary has something to show the
 * reader-facing label on (rollout-canary-and-rollback.md, entry criterion 2):
 *
 *   input  `Av¤Kv` (Bijoy)  →  `¤` is not in the Bijoy table, so the engine
 *   reports it unmapped; the fixture's accepted resolution fills it with `ক`,
 *   marked "Accepted using AI-assisted fallback" /
 *   "AI-সহায়ক বিকল্প পদ্ধতিতে গ্রহণ করা হয়েছে".
 *
 * The same byte and candidate the rollout matrix uses
 * (`app/api/conversion-failures/known/rolloutMatrix.test.ts`), so the path is
 * already proven end to end. No user's text, no Production document, no
 * real provider response. `lib/firebase/__tests__/stagingFixtures.script.test.ts`
 * parses every document with the app's own schemas and renders the label
 * from them, so a schema change that would make the fixture unreadable fails
 * a test instead of the canary.
 *
 * Every id and every free-text field says `staging-fixture`, so the rows are
 * recognisable in the console and removable by id
 * (`scripts/stagingFirebase.mjs unseed`).
 *
 * The pattern carries no `expireAt`, deliberately: Firestore TTL never
 * expires a document without its field, so the fixture outlives the
 * retention period instead of vanishing halfway through a canary.
 */
import { createHash } from "node:crypto";

export const STAGING_FIXTURE_MARKER = "staging-fixture";

export const ACCEPTED_FIXTURE = Object.freeze({
  encodingId: "bijoy",
  failedSequence: "¤",
  candidateConversion: "ক",
  smokeInput: "Av¤Kv",
  patternId: "staging-fixture-bijoy-u00a4",
  resolutionId: "staging-fixture-bijoy-u00a4-accepted",
});

/** Restates `computeResolutionLookupKey` (lib/conversionFailures/resolutionLookup.ts); the test pins them equal. */
export function lookupKeyFor(encodingId, failedSequence) {
  const material = `${encodingId.length}:${encodingId}|${failedSequence.length}:${failedSequence}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * @param {{ now: string }} options ISO timestamp the rows are stamped with
 * @returns {{ collection: string, id: string, data: Record<string, unknown> }[]}
 */
export function stagingFixtureDocuments({ now }) {
  const f = ACCEPTED_FIXTURE;
  return [
    {
      collection: "failurePatterns",
      id: f.patternId,
      data: {
        encodingId: f.encodingId,
        engineVersion: STAGING_FIXTURE_MARKER,
        failedSequence: f.failedSequence,
        failureCategory: "unmapped_character",
        occurrenceCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        sampleOccurrenceIds: [],
        status: "open",
      },
    },
    {
      collection: "aiResolutions",
      id: f.resolutionId,
      data: {
        patternId: f.patternId,
        encodingId: f.encodingId,
        failedSequence: f.failedSequence,
        lookupKey: lookupKeyFor(f.encodingId, f.failedSequence),
        provider: "gemini",
        model: STAGING_FIXTURE_MARKER,
        promptVersion: STAGING_FIXTURE_MARKER,
        engineVersion: STAGING_FIXTURE_MARKER,
        rulesHash: null,
        candidateConversion: f.candidateConversion,
        reasoningSummary: "Synthetic staging fixture; no provider was called.",
        confidence: "high",
        alternativeCandidates: [],
        isCertain: true,
        rawResponse: null,
        status: "reviewed",
        hitCount: 0,
        lastUsedAt: null,
        reviewDecision: "accepted",
        reviewedBy: STAGING_FIXTURE_MARKER,
        reviewedAt: now,
        reviewNote: "Staging fixture for the Stage 1 Preview canary. Not Production data.",
        createdAt: now,
      },
    },
  ];
}
