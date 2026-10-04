/**
 * A fallback pipeline that throws must cost the reader nothing but the
 * fallbacks. `computeConversion` runs inside the converter's render, so an
 * exception there used to take the whole output panel with it — for a
 * feature whose only job is to add marked text on top of output the engine
 * already produced. It now degrades to exactly the pipeline-off result and
 * says so, through `fallbackFailed`, so `useConversion` can report it.
 */
import { describe, expect, it } from "vitest";
import { computeConversion, fallbackFailureIssue, FALLBACK_PIPELINE_ERROR_CODE } from "../fallbackPipeline";
import { convertLegacyText } from "../engine/pipeline";
import type { ResolutionSource } from "../runConversion";

const UNMAPPED_BYTE = "¤";
const INPUT = `Av${UNMAPPED_BYTE}Kv`;

const THROWING: ResolutionSource = {
  lookup: () => {
    throw new Error("snapshot entry malformed");
  },
};

describe("computeConversion when the fallback pipeline throws", () => {
  it("returns the engine's own output, exactly as with the pipeline off", () => {
    const off = computeConversion({ text: INPUT, encodingId: "bijoy", pipelineEnabled: false });
    const failed = computeConversion({
      text: INPUT,
      encodingId: "bijoy",
      pipelineEnabled: true,
      resolutions: THROWING,
    });

    expect(failed.fallback).toBeNull();
    expect(failed.error).toBeNull();
    expect(failed.output).not.toBeNull();
    expect(failed.output).toStrictEqual(off.output);
    const engine = convertLegacyText(INPUT, "bijoy");
    expect(engine.ok && failed.output?.unicodeText).toBe(engine.ok ? engine.value.unicodeText : false);
  });

  it("flags the failure so the caller can report it", () => {
    const failed = computeConversion({
      text: INPUT,
      encodingId: "bijoy",
      pipelineEnabled: true,
      resolutions: THROWING,
    });
    expect(failed.fallbackFailed).toBe(true);
  });

  it("does not flag a pipeline that ran, or one that was off", () => {
    const on = computeConversion({ text: INPUT, encodingId: "bijoy", pipelineEnabled: true });
    const off = computeConversion({ text: INPUT, encodingId: "bijoy", pipelineEnabled: false });
    expect(on.fallbackFailed).toBe(false);
    expect(off.fallbackFailed).toBe(false);
  });

  it("reports a fixed message with no samples, never the input or the thrown text", () => {
    const issue = fallbackFailureIssue("bijoy");
    expect(issue.code).toBe(FALLBACK_PIPELINE_ERROR_CODE);
    expect(issue.encodingId).toBe("bijoy");
    expect(issue.samples).toStrictEqual([]);
    const serialized = JSON.stringify(issue);
    expect(serialized).not.toContain(UNMAPPED_BYTE);
    expect(serialized).not.toContain("snapshot entry malformed");
  });

  it("still reports an unknown encoding as the engine's error, not as a pipeline failure", () => {
    const result = computeConversion({ text: INPUT, encodingId: "no-such-encoding", pipelineEnabled: true });
    expect(result.output).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.fallbackFailed).toBe(false);
  });
});
