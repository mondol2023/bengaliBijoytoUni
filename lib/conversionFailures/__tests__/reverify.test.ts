/**
 * Who decides "resolved". Two halves: the verdict is right, and no path
 * exists by which a caller could supply it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  needsReverification,
  planReverifySweep,
  reverifyPattern,
  statusAfterReverify,
  statusCorrectionOnOccurrence,
  type SweepablePattern,
} from "../reverify";
import { CONVERSION_ENGINE_VERSION } from "@/features/converter/engine/version";

/** "Av" is a Bijoy rule; U+00A4 matches nothing in that table. */
const CONVERTS = "Av";
const STILL_FAILS = "¤";

describe("the verdict comes from the engine, not the caller", () => {
  it("says converts_now for a sequence the current table maps", () => {
    expect(
      reverifyPattern({ encodingId: "bijoy", failedSequence: CONVERTS, engineVersion: "old" }),
    ).toBe("converts_now");
  });

  it("says still_fails for a sequence it does not", () => {
    expect(
      reverifyPattern({ encodingId: "bijoy", failedSequence: STILL_FAILS, engineVersion: "old" }),
    ).toBe("still_fails");
  });

  it("fails closed on a pattern with no encoding", () => {
    expect(
      reverifyPattern({ encodingId: null, failedSequence: CONVERTS, engineVersion: "old" }),
    ).toBe("still_fails");
    expect(reverifyPattern({ encodingId: "", failedSequence: CONVERTS, engineVersion: "old" })).toBe(
      "still_fails",
    );
  });

  it("fails closed on an encoding with no rule table", () => {
    expect(
      reverifyPattern({ encodingId: "not-an-encoding", failedSequence: CONVERTS, engineVersion: "x" }),
    ).toBe("still_fails");
  });

  it("maps each verdict to exactly one status, neither of them a delete", () => {
    expect(statusAfterReverify("converts_now")).toBe("resolved");
    expect(statusAfterReverify("still_fails")).toBe("open");
  });
});

describe("when a pass is due", () => {
  it("is due when the pattern was stored under a different engine", () => {
    expect(
      needsReverification({ encodingId: "bijoy", failedSequence: CONVERTS, engineVersion: "old" }),
    ).toBe(true);
  });

  it("is not due when the engine has not moved", () => {
    expect(
      needsReverification({
        encodingId: "bijoy",
        failedSequence: CONVERTS,
        engineVersion: CONVERSION_ENGINE_VERSION,
      }),
    ).toBe(false);
  });
});

describe("the opportunistic check on a new occurrence", () => {
  it("writes nothing when the stored status is already right", () => {
    expect(
      statusCorrectionOnOccurrence({
        encodingId: "bijoy",
        failedSequence: STILL_FAILS,
        engineVersion: CONVERSION_ENGINE_VERSION,
        status: "open",
      }),
    ).toBeNull();
  });

  it("re-opens a pattern that was marked resolved prematurely", () => {
    expect(
      statusCorrectionOnOccurrence({
        encodingId: "bijoy",
        failedSequence: STILL_FAILS,
        engineVersion: CONVERSION_ENGINE_VERSION,
        status: "resolved",
      }),
    ).toBe("open");
  });

  it("resolves a pattern the table has since grown a rule for", () => {
    expect(
      statusCorrectionOnOccurrence({
        encodingId: "bijoy",
        failedSequence: CONVERTS,
        engineVersion: "old",
        status: "open",
      }),
    ).toBe("resolved");
  });
});

describe("the sweep plans writes without making them", () => {
  const patterns: SweepablePattern[] = [
    { id: "a", encodingId: "bijoy", failedSequence: CONVERTS, engineVersion: "old", status: "open" },
    {
      id: "b",
      encodingId: "bijoy",
      failedSequence: STILL_FAILS,
      engineVersion: "old",
      status: "open",
    },
    {
      id: "c",
      encodingId: "bijoy",
      failedSequence: STILL_FAILS,
      engineVersion: "old",
      status: "resolved",
    },
  ];

  it("changes only the patterns whose status disagrees with the engine", () => {
    const plan = planReverifySweep(patterns);
    expect(plan.examined).toBe(3);
    expect(plan.changes).toStrictEqual([
      { id: "a", status: "resolved", verdict: "converts_now" },
      { id: "c", status: "open", verdict: "still_fails" },
    ]);
  });

  it("plans nothing at all when every status already agrees", () => {
    const plan = planReverifySweep([patterns[1]]);
    expect(plan.changes).toStrictEqual([]);
  });

  it("is a pure function of its input", () => {
    expect(planReverifySweep(patterns)).toStrictEqual(planReverifySweep(patterns));
  });
});

describe("the module cannot delete, and cannot be told an answer", () => {
  const source = readFileSync(path.join(__dirname, "..", "reverify.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("names no delete operation", () => {
    expect(source).not.toMatch(/\bdelete\b/);
  });

  it("reaches no database", () => {
    expect(source).not.toMatch(/firebase|firestore|getAdminDb/i);
  });

  it("ignores everything a caller could attach beyond the stored sequence", () => {
    // statusAfterReverify does take a verdict, but it is a lookup, not a
    // decision: the verdict itself can only come from reverifyPattern, and
    // that reads the stored encoding and sequence and nothing else.
    const stored = { encodingId: "bijoy", failedSequence: STILL_FAILS, engineVersion: "old" };
    const withNoise = {
      ...stored,
      status: "resolved",
      verdict: "converts_now",
      reportedResolved: true,
      occurrenceCount: 1_500_000,
    } as unknown as typeof stored;
    expect(reverifyPattern(withNoise)).toBe(reverifyPattern(stored));
    expect(reverifyPattern(withNoise)).toBe("still_fails");
  });
});
