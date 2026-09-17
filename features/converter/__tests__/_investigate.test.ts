import { describe, it } from "vitest";
import { convertLegacyText } from "../engine/pipeline";
import { validateUnicodeOutput } from "../engine/validate";
import { listEncodings } from "../encodings/registry";
import { bijoyFixtures } from "./bijoy.fixtures";
import { sutonnyFixtures } from "./sutonny.fixtures";
import { alphaAnsiFixtures } from "./alphaAnsi.fixtures";

describe("investigate false positives", () => {
  it("scans all fixtures", () => {
    const allFixtures = [
      { id: "bijoy", fixtures: bijoyFixtures },
      { id: "sutonny", fixtures: sutonnyFixtures },
      { id: "alphaAnsi", fixtures: alphaAnsiFixtures },
    ];
    for (const { id, fixtures } of allFixtures) {
      for (const fx of fixtures) {
        const result = convertLegacyText(fx.input, id);
        if (!result.ok) continue;
        const check = validateUnicodeOutput(result.value.unicodeText);
        if (!check.valid) {
          console.log(`[${id}] "${fx.description}" input=${JSON.stringify(fx.input)} output=${JSON.stringify(result.value.unicodeText)} warnings=${JSON.stringify(check.warnings)}`);
        }
      }
    }
  });
});
