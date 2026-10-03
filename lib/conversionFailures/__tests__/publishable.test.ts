/**
 * The publication rule for the public snapshot: only an `open` pattern
 * justifies publishing, and a resolution is published only while its
 * provenance pattern is `open`. Finding 2 of the threat model; open question
 * 3 of the Phase 5 design.
 */
import { describe, expect, it } from "vitest";
import {
  isPublishableStatus,
  publishablePatterns,
  publishableResolutions,
  type PatternStatus,
} from "../publishable";

describe("isPublishableStatus", () => {
  it("publishes open, and nothing else", () => {
    expect(isPublishableStatus("open")).toBe(true);
    expect(isPublishableStatus("resolved")).toBe(false);
  });

  it("fails closed when there is no stored status at all", () => {
    expect(isPublishableStatus(undefined)).toBe(false);
  });
});

describe("publishablePatterns", () => {
  it("drops resolved patterns and keeps the order of the rest", () => {
    const patterns = [
      { failedSequence: "a", status: "open" as const },
      { failedSequence: "b", status: "resolved" as const },
      { failedSequence: "c", status: "open" as const },
    ];
    expect(publishablePatterns(patterns).map((p) => p.failedSequence)).toStrictEqual(["a", "c"]);
  });
});

describe("publishableResolutions", () => {
  const resolutions = [
    { patternId: "p-open", candidateConversion: "ক" },
    { patternId: "p-resolved", candidateConversion: "খ" },
    { patternId: "p-missing", candidateConversion: "গ" },
  ];
  const statuses = new Map<string, PatternStatus>([
    ["p-open", "open"],
    ["p-resolved", "resolved"],
  ]);

  it("keeps only resolutions whose pattern is currently open", () => {
    expect(publishableResolutions(resolutions, statuses).map((r) => r.patternId)).toStrictEqual([
      "p-open",
    ]);
  });

  it("does not modify the records it filters", () => {
    const before = JSON.stringify(resolutions);
    publishableResolutions(resolutions, statuses);
    expect(JSON.stringify(resolutions)).toBe(before);
  });
});
