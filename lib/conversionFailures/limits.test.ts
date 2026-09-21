import { describe, expect, it } from "vitest";
import { CONVERSION_FAILURE_LIMITS } from "./limits";
import { CONTEXT_WINDOW_CHARS, buildFailureOccurrence } from "./occurrence";
import type { UnmappedDetail } from "@/features/converter/engine/validate";

const detail = (over: Partial<UnmappedDetail> = {}): UnmappedDetail => ({
  sequence: "Av",
  count: 2,
  contexts: [],
  positions: [10],
  ...over,
});

const meta = {
  source: "text" as const,
  encodingId: "bijoy",
  engineVersion: "1.0.0",
  rulesHash: "abc123",
};

describe("context window bound", () => {
  it("never exceeds what the API will accept", () => {
    expect(CONTEXT_WINDOW_CHARS).toBeLessThanOrEqual(CONVERSION_FAILURE_LIMITS.maxContextLength);
  });

  it("clips each side to CONTEXT_WINDOW_CHARS regardless of how long the input is", () => {
    const sequence = "Av";
    const before = "b".repeat(5_000);
    const after = "a".repeat(5_000);
    const sourceText = `${before}${sequence}${after}`;

    const built = buildFailureOccurrence(meta, sourceText, detail({ sequence, positions: [before.length] }));

    expect(built.contextBefore).toHaveLength(CONTEXT_WINDOW_CHARS);
    expect(built.contextAfter).toHaveLength(CONTEXT_WINDOW_CHARS);
  });
});

describe("privacy bound", () => {
  /**
   * The regression this locks down: both reporters used to put the entire
   * conversion input on the wire, so a 200k-character document landed in
   * Firestore verbatim.
   */
  it("carries no field holding the whole source text", () => {
    const secret = "PATIENT NAME AND ADDRESS AND EVERYTHING ELSE IN THE DOCUMENT";
    const sourceText = `${secret} ${"x".repeat(1_000)} Av ${"y".repeat(1_000)} ${secret}`;

    const built = buildFailureOccurrence(meta, sourceText, detail({ positions: [sourceText.indexOf(" Av ") + 1] }));

    const serialized = JSON.stringify(built);
    expect(serialized).not.toContain(secret);
    expect(serialized.length).toBeLessThan(sourceText.length);
  });

  it("never populates engineOutput", () => {
    expect(buildFailureOccurrence(meta, "some Av text", detail({ positions: [5] })).engineOutput).toBeNull();
  });

  it("emits no fullText key at all", () => {
    const built = buildFailureOccurrence(meta, "some Av text", detail({ positions: [5] }));
    expect(Object.keys(built)).not.toContain("fullText");
  });

  it("still keeps the evidence an admin needs to fix a mapping rule", () => {
    const built = buildFailureOccurrence(meta, "before Av after", detail({ positions: [7] }));
    expect(built.failedSequence).toBe("Av");
    expect(built.contextBefore).toBe("before ");
    expect(built.contextAfter).toBe(" after");
    expect(built.position).toBe(7);
  });

  it("degrades to empty context rather than guessing when position is unknown", () => {
    const built = buildFailureOccurrence(meta, "before Av after", detail({ positions: [] }));
    expect(built.position).toBeNull();
    expect(built.contextBefore).toBe("");
    expect(built.contextAfter).toBe("");
  });
});
