import { describe, expect, it } from "vitest";
import { mapResolutionConfidence } from "./confidenceMapping";

describe("mapResolutionConfidence", () => {
  it("maps 'high' to 'high'", () => {
    expect(mapResolutionConfidence("high")).toBe("high");
  });

  it("maps 'medium' to 'medium'", () => {
    expect(mapResolutionConfidence("medium")).toBe("medium");
  });

  it("maps 'low' to 'low'", () => {
    expect(mapResolutionConfidence("low")).toBe("low");
  });

  it("maps null to 'unknown'", () => {
    expect(mapResolutionConfidence(null)).toBe("unknown");
  });
});
