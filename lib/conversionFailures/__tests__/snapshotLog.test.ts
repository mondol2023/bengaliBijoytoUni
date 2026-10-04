import { describe, expect, it } from "vitest";
import { emitKnownSnapshotBuilt, knownSnapshotBuiltEvent } from "../snapshotLog";
import type { KnownPatternsSnapshot } from "../knownPatterns";
import { TBD_LABEL } from "../knownResolutions";

const CANDIDATE = "সেন্টিনেল";
const SEQUENCE = "¤SEQ";

function snapshot(overrides: Partial<KnownPatternsSnapshot> = {}): KnownPatternsSnapshot {
  return {
    encodingId: "bijoy",
    engineVersion: "engine-1",
    patterns: [{ failedSequence: SEQUENCE, failureCategory: "unmapped_character", resolved: false }],
    resolutions: [
      { failedSequence: SEQUENCE, candidateConversion: CANDIDATE, verification: "accepted", label: null, engineVersion: "engine-1" },
      { failedSequence: "x", candidateConversion: CANDIDATE, verification: "unverified", label: TBD_LABEL, engineVersion: "engine-1" },
      { failedSequence: "y", candidateConversion: CANDIDATE, verification: "unverified", label: TBD_LABEL, engineVersion: "engine-1" },
    ],
    generatedAt: "2026-10-04T00:00:00.000Z",
    ...overrides,
  } as KnownPatternsSnapshot;
}

describe("knownSnapshotBuiltEvent", () => {
  it("counts what is published, split by verification", () => {
    expect(knownSnapshotBuiltEvent(snapshot(), true)).toStrictEqual({
      metric: "known_snapshot_built",
      encodingId: "bijoy",
      engineVersion: "engine-1",
      serveUnverified: true,
      patterns: 1,
      resolutionsAccepted: 1,
      resolutionsUnverified: 2,
    });
  });

  it("carries no sequence, candidate text or label", () => {
    const line = JSON.stringify(knownSnapshotBuiltEvent(snapshot(), true));
    expect(line).not.toContain(CANDIDATE);
    expect(line).not.toContain(SEQUENCE);
    expect(line).not.toContain(TBD_LABEL.en);
  });

  it("does not log an arbitrary query-string encodingId as itself", () => {
    const event = knownSnapshotBuiltEvent(snapshot({ encodingId: "bijoy\nFAKE LOG LINE" }), false);
    expect(event.encodingId).toBe("(other)");
  });
});

describe("emitKnownSnapshotBuilt", () => {
  it("emits one JSON line", () => {
    const lines: string[] = [];
    emitKnownSnapshotBuilt(snapshot(), false, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).metric).toBe("known_snapshot_built");
  });

  it("never throws, even when the sink does", () => {
    expect(() =>
      emitKnownSnapshotBuilt(snapshot(), false, () => {
        throw new Error("stdout closed");
      }),
    ).not.toThrow();
  });
});
