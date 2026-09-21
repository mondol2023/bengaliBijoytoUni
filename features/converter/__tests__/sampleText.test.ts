import { describe, expect, it } from "vitest";
import { SAMPLE_TEXT } from "../sampleText";
import { listEncodings } from "../encodings/registry";
import { convertLegacyText } from "../engine/pipeline";

/**
 * The "Load sample" button is the first thing a new user clicks. A sample
 * that produces unmapped-character warnings makes a working converter look
 * broken, so every registered encoding needs one and it must convert clean.
 */
describe("SAMPLE_TEXT", () => {
  for (const encoding of listEncodings()) {
    it(`has a sample for ${encoding.id}`, () => {
      expect(SAMPLE_TEXT[encoding.id]).toBeTruthy();
    });

    it(`converts ${encoding.id}'s sample with no unmapped sequences`, () => {
      const result = convertLegacyText(SAMPLE_TEXT[encoding.id] ?? "", encoding.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.validation.unmappedDetails).toEqual([]);
      }
    });
  }
});
