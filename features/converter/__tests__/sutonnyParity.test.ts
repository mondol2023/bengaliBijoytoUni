import { describe, expect, it } from "vitest";
import { getEncoding, listEncodings } from "../encodings/registry";
import { convertLegacyText } from "../engine/pipeline";
import { detectEncoding } from "../engine/detectEncoding";
import { bijoyFixtures } from "./bijoy.fixtures";

/**
 * E1. SutonnyMJ was registered with its own provisional rule table that
 * deliberately assigned different legacy bytes to the same Bengali glyphs,
 * so real SutonnyMJ text converted to nonsense whenever a user picked the
 * encoding named after their own font. It now aliases the Bijoy table.
 *
 * These tests are the condition attached to deleting the old table: they
 * must hold before `encodings/sutonny/map.ts` is removed.
 */
describe("sutonny ↔ bijoy parity", () => {
  const sutonny = getEncoding("sutonny");
  const bijoy = getEncoding("bijoy");

  it("registers both encodings", () => {
    expect(sutonny).toBeDefined();
    expect(bijoy).toBeDefined();
  });

  it("shares the Bijoy rule table by reference, so the two cannot drift", () => {
    expect(sutonny!.rules).toBe(bijoy!.rules);
  });

  it("shares the Bijoy post-process pass by reference", () => {
    expect(sutonny!.postProcess).toBe(bijoy!.postProcess);
  });

  it("keeps the user-visible SutonnyMJ label and its own id", () => {
    expect(sutonny!.id).toBe("sutonny");
    expect(sutonny!.name).toBe("SutonnyMJ");
  });

  it("no longer references the provisional sutonny table", async () => {
    const provisional = await import("../encodings/sutonny/map");
    expect(sutonny!.rules).not.toBe(provisional.sutonnyRules);
  });

  it("leaves the other registered encodings on their own tables", () => {
    const alphaAnsi = getEncoding("alpha-ansi");
    expect(alphaAnsi!.rules).not.toBe(bijoy!.rules);
    expect(listEncodings().map((e) => e.id).sort()).toEqual(["alpha-ansi", "bijoy", "sutonny"]);
  });
});

describe("sutonny converts the whole Bijoy corpus identically", () => {
  for (const fixture of bijoyFixtures) {
    it(fixture.description, () => {
      const viaSutonny = convertLegacyText(fixture.input, "sutonny");
      const viaBijoy = convertLegacyText(fixture.input, "bijoy");

      expect(viaSutonny.ok).toBe(true);
      expect(viaBijoy.ok).toBe(true);
      if (viaSutonny.ok && viaBijoy.ok) {
        expect(viaSutonny.value.unicodeText).toBe(fixture.expected);
        expect(viaSutonny.value.unicodeText).toBe(viaBijoy.value.unicodeText);
      }
    });
  }
});

describe("auto-detect with two ids on one table", () => {
  /**
   * Aliasing makes `sutonny` and `bijoy` score identically on every input,
   * so detection is decided by `Array.prototype.sort`'s stability and the
   * registration order in `encodings/registry.ts`. That is deterministic but
   * implicit: pinning it here means reordering the registry fails a test
   * rather than silently relabelling every auto-detected conversion in the
   * UI. Which of the two wins does not change the output — only the label.
   */
  const input = "wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv/mggvb MÖnY‡hvM¨ n‡e bv|";

  it("scores the two aliases identically", () => {
    const { scores } = detectEncoding(input);
    const sutonny = scores.find((s) => s.encodingId === "sutonny");
    const bijoy = scores.find((s) => s.encodingId === "bijoy");
    expect(sutonny!.confidence).toBe(bijoy!.confidence);
  });

  it("resolves the tie to bijoy, the canonical table name", () => {
    expect(detectEncoding(input).encodingId).toBe("bijoy");
  });
});

describe("the real SutonnyMJ document that motivated the alias", () => {
  /**
   * Lifted from the govt job circular block in `bijoy.fixtures.ts` — real
   * SutonnyMJ bytes. Under the old provisional table this produced unmapped
   * warnings and garbled output when the user selected "SutonnyMJ".
   */
  const input = "wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv/mggvb MÖnY‡hvM¨ n‡e bv|";
  const expected = "শিক্ষা বোর্ড হতে কম্পিউটার ডিপ্লোমা/সমমান গ্রহণযোগ্য হবে না।";

  it("converts correctly when the user picks SutonnyMJ", () => {
    const result = convertLegacyText(input, "sutonny");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.unicodeText).toBe(expected);
  });

  it("reports no unmapped sequences for real SutonnyMJ text", () => {
    const result = convertLegacyText(input, "sutonny");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.validation.unmappedDetails).toEqual([]);
  });
});
