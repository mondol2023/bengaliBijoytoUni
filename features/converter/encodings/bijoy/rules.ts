import type { Token } from "../types";

/**
 * Encoding-specific fixups applied after tokenizing and before the engine's
 * generic reorder pass. The generic pass (driven by each rule's `reorder`
 * flag — see `map.ts`) already handles the common pre-base/reph movements;
 * this hook exists for Bijoy-specific exceptions that don't fit that generic
 * model (e.g. a handful of vowel-sign combinations that behave differently
 * next to specific consonants). None are known/verified yet — extend this
 * as real-world test cases surface them, rather than special-casing inside
 * the shared engine.
 */
export function bijoyPostProcess(tokens: Token[]): Token[] {
  return tokens;
}
