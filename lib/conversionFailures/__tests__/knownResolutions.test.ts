/**
 * What may be published, in what order, and how much of it. The three
 * questions are separable, so they are tested separately — and the first one
 * is tested hardest, because getting it wrong means unreviewed model output
 * reaching every user of an encoding.
 */
import { describe, expect, it } from "vitest";
import {
  AI_UNVERIFIED_LABEL,
  KNOWN_RESOLUTIONS_DEFAULT_LIMIT,
  KNOWN_RESOLUTIONS_MAX_BYTES,
  knownResolutionSchema,
  type StoredResolution,
} from "../knownResolutions";
import { selectServableResolutions } from "../selectResolutions";

function stored(overrides: Partial<StoredResolution> = {}): StoredResolution {
  return {
    encodingId: "bijoy",
    failedSequence: "Av",
    candidateConversion: "আ",
    engineVersion: "1.0.0",
    status: "reviewed",
    reviewDecision: "accepted",
    hitCount: 0,
    lastUsedAt: null,
    lookupKey: "key-1",
    ...overrides,
  };
}

function select(resolutions: StoredResolution[], serveUnverified = false, rest = {}) {
  return selectServableResolutions({ resolutions, serveUnverified, ...rest });
}

describe("what may be published", () => {
  it("publishes an accepted resolution", () => {
    const published = select([stored()]);
    expect(published).toHaveLength(1);
    expect(published[0].verification).toBe("accepted");
    expect(published[0].candidateConversion).toBe("আ");
  });

  it("never publishes a rejected resolution, flag or no flag", () => {
    const rejected = [stored({ reviewDecision: "rejected" })];
    expect(select(rejected)).toHaveLength(0);
    expect(select(rejected, true)).toHaveLength(0);
  });

  it("does not publish an unreviewed resolution by default", () => {
    expect(select([stored({ status: "completed", reviewDecision: null })])).toHaveLength(0);
  });

  it("publishes an unreviewed resolution only when the flag is on", () => {
    const published = select([stored({ status: "completed", reviewDecision: null })], true);
    expect(published).toHaveLength(1);
    expect(published[0].verification).toBe("unverified");
  });

  it("still withholds pending and failed records when the flag is on", () => {
    // `pending` has no answer yet and `failed` is either a provider error or
    // a validator rejection. Neither is a candidate anyone chose to publish.
    const published = select(
      [
        stored({ status: "pending", reviewDecision: null, lookupKey: "a" }),
        stored({ status: "failed", reviewDecision: null, lookupKey: "b" }),
      ],
      true,
    );
    expect(published).toHaveLength(0);
  });

  it("drops a record with no candidate", () => {
    expect(select([stored({ candidateConversion: null })])).toHaveLength(0);
    expect(select([stored({ candidateConversion: "" })])).toHaveLength(0);
  });
});

describe("the label travels in the payload", () => {
  it("labels an unverified entry and leaves an accepted one unlabelled", () => {
    const unverified = select([stored({ status: "completed", reviewDecision: null })], true);
    expect(unverified[0].label).toStrictEqual(AI_UNVERIFIED_LABEL);
    expect(select([stored()])[0].label).toBeNull();
  });

  it("says the same thing in both languages, and says it at all", () => {
    expect(AI_UNVERIFIED_LABEL.en).toContain("unverified");
    expect(AI_UNVERIFIED_LABEL.bn.length).toBeGreaterThan(0);
    expect(AI_UNVERIFIED_LABEL.bn).not.toBe(AI_UNVERIFIED_LABEL.en);
  });

  it("makes label and verification agree, as the schema requires", () => {
    for (const entry of select(
      [stored({ lookupKey: "a" }), stored({ status: "completed", reviewDecision: null, lookupKey: "b" })],
      true,
    )) {
      expect(knownResolutionSchema.safeParse(entry).success).toBe(true);
      expect(entry.label === null).toBe(entry.verification === "accepted");
    }
  });
});

describe("the validator's second run", () => {
  it("withholds an accepted resolution that no longer validates", () => {
    // The case this exists for: a human accepted it, and the answer has
    // since stopped being right. Acceptance is a record of a past judgement,
    // not a standing guarantee.
    expect(select([stored({ candidateConversion: "Av" })])).toHaveLength(0);
  });

  it("withholds one whose encoding is no longer registered", () => {
    expect(select([stored({ encodingId: "retired-font" })])).toHaveLength(0);
  });

  it("withholds one with no encoding at all", () => {
    expect(select([stored({ encodingId: null })])).toHaveLength(0);
  });

  it("does not let a valid neighbour be dropped along with an invalid one", () => {
    const published = select([
      stored({ candidateConversion: "Av", lookupKey: "bad" }),
      stored({ candidateConversion: "আ", lookupKey: "good" }),
    ]);
    expect(published).toHaveLength(1);
    expect(published[0].candidateConversion).toBe("আ");
  });
});

describe("ordering and the top-N cut", () => {
  it("puts the most-used first", () => {
    const published = select([
      stored({ hitCount: 1, lookupKey: "a", failedSequence: "Kv" }),
      stored({ hitCount: 99, lookupKey: "b", failedSequence: "Rv" }),
      stored({ hitCount: 10, lookupKey: "c", failedSequence: "Mv" }),
    ]);
    expect(published.map((entry) => entry.failedSequence)).toStrictEqual(["Rv", "Mv", "Kv"]);
  });

  it("breaks a tie on count by most recently used", () => {
    const published = select([
      stored({ hitCount: 5, lastUsedAt: "2026-01-01T00:00:00.000Z", lookupKey: "a", failedSequence: "Kv" }),
      stored({ hitCount: 5, lastUsedAt: "2026-09-01T00:00:00.000Z", lookupKey: "b", failedSequence: "Rv" }),
    ]);
    expect(published[0].failedSequence).toBe("Rv");
  });

  it("is a total order, so the ETag does not change for nothing", () => {
    // Two resolutions identical but for their key must not swap places
    // between builds; every swap is a spurious cache invalidation.
    const a = stored({ lookupKey: "aaa", failedSequence: "Kv" });
    const b = stored({ lookupKey: "bbb", failedSequence: "Rv" });
    expect(select([a, b]).map((entry) => entry.failedSequence)).toStrictEqual(
      select([b, a]).map((entry) => entry.failedSequence),
    );
  });

  it("does not publish more than the limit", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      stored({ lookupKey: `key-${index}`, hitCount: index }),
    );
    expect(select(many)).toHaveLength(KNOWN_RESOLUTIONS_DEFAULT_LIMIT);
    expect(select(many, false, { limit: 3 })).toHaveLength(3);
  });

  it("keeps the most-used ones when it cuts, not the first ones it saw", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      stored({
        lookupKey: `key-${index}`,
        hitCount: index,
        failedSequence: "Av".repeat(index + 1),
        candidateConversion: "আ".repeat(index + 1),
      }),
    );
    const published = select(many, false, { limit: 2 });
    expect(published.map((entry) => entry.failedSequence)).toStrictEqual([
      "Av".repeat(30),
      "Av".repeat(29),
    ]);
  });
});

describe("the size cap", () => {
  it("stops before exceeding the byte budget", () => {
    const long = "আ".repeat(300);
    const many = Array.from({ length: 20 }, (_, index) =>
      stored({ lookupKey: `key-${index}`, failedSequence: "A".repeat(100), candidateConversion: long }),
    );
    const published = select(many, false, { maxBytes: 2_000 });
    expect(published.length).toBeGreaterThan(0);
    expect(published.length).toBeLessThan(20);
    expect(new TextEncoder().encode(JSON.stringify(published)).length).toBeLessThanOrEqual(2_500);
  });

  it("publishes nothing rather than one oversized entry", () => {
    expect(select([stored()], false, { maxBytes: 1 })).toHaveLength(0);
  });

  it("has a default budget a browser cache can hold", () => {
    // `knownPatternsClient.ts` keeps up to 8 encodings in `localStorage`,
    // whose per-origin budget is conventionally about 5 MB.
    expect(KNOWN_RESOLUTIONS_MAX_BYTES * 8).toBeLessThan(1_000_000);
  });
});

describe("nothing else leaks", () => {
  it("publishes exactly the five declared fields", () => {
    const published = select([stored({ hitCount: 4_312, lastUsedAt: "2026-09-01T00:00:00.000Z" })]);
    expect(Object.keys(published[0]).sort()).toStrictEqual([
      "candidateConversion",
      "engineVersion",
      "failedSequence",
      "label",
      "verification",
    ]);
  });

  it("does not publish the count that decides the order", () => {
    const published = select([stored({ hitCount: 4_312 })]);
    expect(JSON.stringify(published)).not.toContain("4312");
    expect(JSON.stringify(published)).not.toContain("lookupKey");
  });
});
