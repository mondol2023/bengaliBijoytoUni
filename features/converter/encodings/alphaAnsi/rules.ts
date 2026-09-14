import type { Token } from "../types";

/** Below-base vowel signs, which this layout types before an attached fola. */
const BELOW_BASE_KAR = /^[ুূৃ]$/u;

/**
 * Swaps a below-base kar with a fola typed straight after it.
 *
 * Legacy order is visual: in মৃত্যু the ু is drawn under ত and the ্য after
 * it, so the bytes read ত ু ্য. Unicode stores the fola first (ত ্ য ু).
 */
export function alphaAnsiPostProcess(tokens: Token[]): Token[] {
  const output = [...tokens];
  for (let i = 0; i < output.length - 1; i += 1) {
    if (BELOW_BASE_KAR.test(output[i].unicode) && output[i + 1].unicode.startsWith("্")) {
      [output[i], output[i + 1]] = [output[i + 1], output[i]];
    }
  }
  return output;
}
