import { describe, expect, it } from "vitest";
import { knownPatternsSnapshotSchema, toKnownPattern } from "../knownPatterns";

/**
 * `toKnownPattern` is the single narrow point every stored pattern passes
 * through on its way to a public response. Tested here rather than only at
 * the route, because the route test would still pass if someone added a
 * fourth field to both.
 */
describe("toKnownPattern", () => {
  const stored = {
    encodingId: "bijoy",
    engineVersion: "1.0.0",
    failedSequence: "Av",
    failureCategory: "unmapped_character" as const,
    occurrenceCount: 99,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    sampleOccurrenceIds: ["occurrence-1"],
    status: "open" as const,
  };

  it("keeps exactly the three published fields", () => {
    expect(Object.keys(toKnownPattern(stored)).sort()).toStrictEqual([
      "failedSequence",
      "failureCategory",
      "status",
    ]);
  });

  it("carries their values through unchanged", () => {
    expect(toKnownPattern(stored)).toStrictEqual({
      failedSequence: "Av",
      failureCategory: "unmapped_character",
      status: "open",
    });
  });

  it("drops every other field, including ones added to the source later", () => {
    const withExtra = { ...stored, somethingAddedLater: "user's whole document" };
    expect(JSON.stringify(toKnownPattern(withExtra))).not.toContain("document");
  });
});

describe("knownPatternsSnapshotSchema", () => {
  const valid = {
    encodingId: "bijoy",
    engineVersion: "1.0.0",
    patterns: [{ failedSequence: "Av", failureCategory: "unmapped_character", status: "open" }],
    generatedAt: "2026-09-21T00:00:00.000Z",
  };

  it("accepts a well-formed snapshot", () => {
    expect(knownPatternsSnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an empty pattern list, which is what an unconfigured backend returns", () => {
    expect(knownPatternsSnapshotSchema.safeParse({ ...valid, patterns: [] }).success).toBe(true);
  });

  it("rejects an unknown failure category", () => {
    const bad = { ...valid, patterns: [{ ...valid.patterns[0], failureCategory: "invented" }] };
    expect(knownPatternsSnapshotSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const bad = { ...valid, patterns: [{ ...valid.patterns[0], status: "in_progress" }] };
    expect(knownPatternsSnapshotSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty failed sequence", () => {
    const bad = { ...valid, patterns: [{ ...valid.patterns[0], failedSequence: "" }] };
    expect(knownPatternsSnapshotSchema.safeParse(bad).success).toBe(false);
  });
});
