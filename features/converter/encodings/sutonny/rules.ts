import type { Token } from "../types";

/**
 * SutonnyMJ-specific fixups applied after tokenizing and before the engine's
 * generic reorder pass. See `bijoy/rules.ts` for the rationale — none are
 * known/verified yet.
 */
export function sutonnyPostProcess(tokens: Token[]): Token[] {
  return tokens;
}
