/**
 * Two things matter here: the report carries enough for someone to act on
 * it, and it carries nothing that could act by itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeSequence, fallbackReportDraft } from "../feedbackDraft";
import type { RenderSegment } from "../runConversion";
import { FEEDBACK_LIMITS } from "@/lib/feedback/limits";

function segment(overrides: Partial<RenderSegment> = {}): RenderSegment {
  return {
    text: "অ",
    state: "fallback_accepted",
    failedSequence: "¥",
    label: null,
    sourceIndex: 0,
    ...overrides,
  };
}

describe("what the report carries", () => {
  it("pre-fills the existing wrong_conversion category", () => {
    expect(fallbackReportDraft("bijoy", segment())?.category).toBe("wrong_conversion");
  });

  it("carries the sequence as the input and the substitution as the output", () => {
    const draft = fallbackReportDraft("bijoy", segment());
    expect(draft?.sampleInput).toBe("¥");
    expect(draft?.sampleOutput).toBe("অ");
    expect(draft?.encodingId).toBe("bijoy");
  });

  it("spells the sequence out in code points, since the bytes may not render", () => {
    expect(describeSequence("¥")).toBe("¥ (U+00A5)");
    expect(describeSequence("Av")).toBe("Av (U+0041 U+0076)");
  });

  it("names where the substitution came from, differently for each state", () => {
    const accepted = fallbackReportDraft("bijoy", segment())?.message ?? "";
    const unverified =
      fallbackReportDraft("bijoy", segment({ state: "fallback_unverified" }))?.message ?? "";
    expect(accepted).toContain("admin accepted");
    expect(unverified).toContain("unverified");
    expect(accepted).not.toBe(unverified);
  });

  it("stays inside the limits the route enforces", () => {
    const long = "x".repeat(FEEDBACK_LIMITS.maxSampleLength * 3);
    const draft = fallbackReportDraft("bijoy", segment({ text: long, failedSequence: long }));
    expect(draft?.sampleInput.length).toBe(FEEDBACK_LIMITS.maxSampleLength);
    expect(draft?.sampleOutput.length).toBe(FEEDBACK_LIMITS.maxSampleLength);
    expect(draft?.message.length).toBeLessThanOrEqual(FEEDBACK_LIMITS.maxMessageLength);
  });
});

describe("where the control appears", () => {
  it("offers nothing on a clean run", () => {
    expect(fallbackReportDraft("bijoy", segment({ state: "clean", failedSequence: null }))).toBeNull();
  });

  it("offers nothing on an unresolved run, which was never filled in", () => {
    expect(fallbackReportDraft("bijoy", segment({ state: "unresolved" }))).toBeNull();
  });

  it("offers nothing without a sequence to name", () => {
    expect(fallbackReportDraft("bijoy", segment({ failedSequence: null }))).toBeNull();
    expect(fallbackReportDraft("bijoy", segment({ failedSequence: "" }))).toBeNull();
  });
});

describe("a report is evidence, not a trigger", () => {
  const FEEDBACK_FIELDS = ["category", "encodingId", "sampleInput", "sampleOutput", "message"];

  it("carries no field beyond the ones the feedback route already takes", () => {
    const draft = fallbackReportDraft("bijoy", segment());
    expect(Object.keys(draft ?? {}).sort()).toStrictEqual([...FEEDBACK_FIELDS].sort());
  });

  it("carries no status, verdict, resolution id or count", () => {
    const draft = fallbackReportDraft("bijoy", segment()) as unknown as Record<string, unknown>;
    for (const forbidden of ["status", "verdict", "resolutionId", "patternId", "reports", "count"]) {
      expect(draft[forbidden]).toBeUndefined();
    }
  });

  it("reaches no endpoint of its own", () => {
    const source = readFileSync(path.join(__dirname, "..", "feedbackDraft.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/fetch\(|\/api\//);
  });
});
