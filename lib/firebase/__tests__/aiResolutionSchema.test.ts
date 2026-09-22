/**
 * `aiResolutions` records written before Phase 4 carry none of the lookup
 * fields. They are still read — by the admin detail page, and by the claim
 * transaction in `resolveConversionFailure` — so a schema that rejected them
 * would turn a data-shape change into a broken admin screen.
 *
 * These tests pin the two halves of that: a legacy record parses, and what
 * it parses to is invisible to the lookup rather than wrongly matched.
 */
import { describe, expect, it } from "vitest";
import { aiResolutionSchema } from "../schemas";
import { computeResolutionLookupKey } from "@/lib/conversionFailures/resolutionLookup";

/** Exactly the pre-Phase-4 field set, with nothing added. */
const legacyRecord = {
  patternId: "pattern-1",
  provider: "gemini",
  model: "gemini-2.0-flash",
  promptVersion: "v1",
  engineVersion: "engine-1.2.3",
  rulesHash: "rules-abc",
  candidateConversion: "ক",
  reasoningSummary: null,
  confidence: "high",
  alternativeCandidates: [],
  isCertain: true,
  rawResponse: null,
  status: "completed",
  reviewDecision: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("aiResolutions records written before the Phase 4 lookup key", () => {
  it("still parse", () => {
    const parsed = aiResolutionSchema.safeParse(legacyRecord);
    expect(parsed.success).toBe(true);
  });

  it("parse to an empty lookupKey, which matches no query", () => {
    // The safe direction: a legacy record is not served rather than served
    // against the wrong sequence. Backfilling one is possible later — the
    // pattern it points at still holds encodingId and failedSequence.
    const parsed = aiResolutionSchema.parse(legacyRecord);
    expect(parsed.lookupKey).toBe("");
    expect(parsed.encodingId).toBeNull();
    expect(parsed.failedSequence).toBe("");
    expect(parsed.lookupKey).not.toBe(
      computeResolutionLookupKey({ encodingId: null, failedSequence: "" }),
    );
  });

  it("keeps a supplied lookup key rather than defaulting over it", () => {
    const key = computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "Av" });
    const parsed = aiResolutionSchema.parse({
      ...legacyRecord,
      encodingId: "bijoy",
      failedSequence: "Av",
      lookupKey: key,
    });
    expect(parsed.lookupKey).toBe(key);
    expect(parsed.encodingId).toBe("bijoy");
  });
});
