import { describe, expect, it } from "vitest";
import { computeRulesHash } from "./version";
import type { EncodingDefinition } from "../encodings/types";

function encodingWithRules(rules: EncodingDefinition["rules"]): EncodingDefinition {
  return { id: "test", name: "Test", maturity: "experimental", rules };
}

describe("computeRulesHash", () => {
  it("is stable for the same rule table", () => {
    const encoding = encodingWithRules([{ match: "K", unicode: "ক" }]);
    expect(computeRulesHash(encoding)).toBe(computeRulesHash(encoding));
  });

  it("is stable across separate but identical rule tables", () => {
    const a = encodingWithRules([{ match: "K", unicode: "ক", reorder: "none" }]);
    const b = encodingWithRules([{ match: "K", unicode: "ক", reorder: "none" }]);
    expect(computeRulesHash(a)).toBe(computeRulesHash(b));
  });

  it("changes when a rule's unicode mapping changes", () => {
    const a = encodingWithRules([{ match: "K", unicode: "ক" }]);
    const b = encodingWithRules([{ match: "K", unicode: "খ" }]);
    expect(computeRulesHash(a)).not.toBe(computeRulesHash(b));
  });

  it("changes when a rule is added", () => {
    const a = encodingWithRules([{ match: "K", unicode: "ক" }]);
    const b = encodingWithRules([{ match: "K", unicode: "ক" }, { match: "L", unicode: "খ" }]);
    expect(computeRulesHash(a)).not.toBe(computeRulesHash(b));
  });

  it("changes when only the reorder kind differs", () => {
    const a = encodingWithRules([{ match: "w", unicode: "ি", reorder: "before-consonant" }]);
    const b = encodingWithRules([{ match: "w", unicode: "ি", reorder: "after-consonant" }]);
    expect(computeRulesHash(a)).not.toBe(computeRulesHash(b));
  });

  it("returns a hex string", () => {
    const encoding = encodingWithRules([{ match: "K", unicode: "ক" }]);
    expect(computeRulesHash(encoding)).toMatch(/^[0-9a-f]+$/);
  });
});
