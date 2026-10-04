import type { Token } from "../types";

/** Below-base vowel signs, which this layout types before an attached fola. */
const BELOW_BASE_KAR = /^[ুূৃ]$/u;

/** A fola token: ্র/্য/্ব/... carried on its own byte. */
const FOLA = /^্[ক-হ]$/u;

/** A token whose output ends in a consonant, i.e. something a fola can hang off. */
const ENDS_IN_CONSONANT = /[ক-হ়]$/u;

/**
 * First halves of conjuncts whose second half is the digit byte "1" (the
 * ¹ glyph after a copy path folded it). Alone they mean nothing, so a "1"
 * separated from one by a displaced reph is still its second half.
 */
const FIRST_HALF_OF_1: Record<string, string> = { "¿": "ন্ত" };

/**
 * Swaps a below-base kar with a fola typed straight after it.
 *
 * Legacy order is visual: in মৃত্যু the ু is drawn under ত and the ্য after
 * it, so the bytes read ত ু ্য. Unicode stores the fola first (ত ্ য ু).
 *
 * Also repairs two displacements that PDF text extraction makes in this
 * layout. Its below-base and above-base glyphs (folas, reph) are zero-width,
 * so the extractor can emit one a slot late and even put a space before the
 * glyph after it:
 *
 *  - "f¢Ða" for "fÐ¢a" (প্রতি): a pre-base vowel sign directly before a fola
 *    is never valid typed order, so the fola goes back onto the consonant.
 *  - "fk¿Ñ 1" for "fkÑ¿1" (পর্যন্ত): the reph lands between ¿ and its "1".
 *    The reph is moved ahead of the rejoined ন্ত, so the reorder pass still
 *    puts it before the cluster the reph was typed after.
 */
export function alphaAnsiPostProcess(tokens: Token[]): Token[] {
  const output: Token[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const firstHalf = FIRST_HALF_OF_1[token.legacy];
    if (firstHalf && tokens[i + 1]?.reorder === "reph") {
      const gap = tokens[i + 2]?.legacy === " " ? 1 : 0;
      const second = tokens[i + 2 + gap];
      if (second?.legacy === "1") {
        output.push(tokens[i + 1], {
          legacy: token.legacy + second.legacy,
          unicode: firstHalf,
          reorder: "none",
          sourceIndex: token.sourceIndex,
        });
        i += 2 + gap;
        continue;
      }
    }
    output.push(token);
  }

  for (let i = 1; i < output.length - 1; i += 1) {
    if (
      output[i].reorder === "before-consonant" &&
      FOLA.test(output[i + 1].unicode) &&
      ENDS_IN_CONSONANT.test(output[i - 1].unicode)
    ) {
      [output[i], output[i + 1]] = [output[i + 1], output[i]];
    }
  }

  for (let i = 0; i < output.length - 1; i += 1) {
    if (BELOW_BASE_KAR.test(output[i].unicode) && output[i + 1].unicode.startsWith("্")) {
      [output[i], output[i + 1]] = [output[i + 1], output[i]];
    }
  }
  return output;
}
