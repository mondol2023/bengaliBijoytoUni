import type { GlyphRule } from "../types";

/**
 * ⚠️ PROVISIONAL STARTER TABLE — NOT YET VALIDATED.
 *
 * Same caveat as `encodings/bijoy/map.ts`: this is a best-effort, structural
 * placeholder for the SutonnyMJ ASCII-keyboard → Bengali-glyph convention,
 * not a verified reference table. SutonnyMJ and Bijoy Classic are distinct,
 * independently-defined legacy layouts, so this table intentionally assigns
 * *different* legacy keys to the same Bengali glyphs — it exists to prove
 * the registry/engine can host multiple independent encodings side by side,
 * and needs the same real-sample validation pass before production use.
 * Record every verified case in `__tests__/sutonny.fixtures.ts`.
 */
export const sutonnyRules: GlyphRule[] = [
  // --- Independent vowels ---
  { match: "A", unicode: "অ" },
  { match: "AvB", unicode: "আ" },
  { match: "Bt", unicode: "ই" },
  { match: "D", unicode: "ঈ" },
  { match: "E", unicode: "উ" },
  { match: "Cz", unicode: "ঊ" },
  { match: "F", unicode: "ঋ" },
  { match: "G", unicode: "এ" },
  { match: "H", unicode: "ঐ" },
  { match: "I", unicode: "ও" },
  { match: "J", unicode: "ঔ" },

  // --- Consonants ---
  { match: "K", unicode: "ক" },
  { match: "L", unicode: "খ" },
  { match: "M", unicode: "গ" },
  { match: "N", unicode: "ঘ" },
  { match: "O", unicode: "ঙ" },
  { match: "P", unicode: "চ" },
  { match: "Q", unicode: "ছ" },
  { match: "R", unicode: "জ" },
  { match: "S", unicode: "ঝ" },
  { match: "U", unicode: "ঞ" },
  { match: "V", unicode: "ট" },
  { match: "W", unicode: "ঠ" },
  { match: "X", unicode: "ড" },
  { match: "Y", unicode: "ঢ" },
  { match: "Z", unicode: "ণ" },
  { match: "t", unicode: "ত" },
  { match: "_", unicode: "থ" },
  { match: "w", unicode: "দ" },
  { match: "a", unicode: "ধ" },
  { match: "b", unicode: "ন" },
  { match: "c", unicode: "প" },
  { match: "d", unicode: "ফ" },
  { match: "e", unicode: "ব" },
  { match: "f", unicode: "ভ" },
  { match: "g", unicode: "ম" },
  { match: "h", unicode: "য" },
  { match: "i", unicode: "র" },
  { match: "j", unicode: "ল" },
  { match: "k", unicode: "শ" },
  { match: "l", unicode: "ষ" },
  { match: "m", unicode: "স" },
  { match: "n", unicode: "হ" },

  // --- Post-base diacritics (no reorder) ---
  { match: "u", unicode: "ঁ", reorder: "after-consonant" }, // chandrabindu
  { match: ";", unicode: "ঃ", reorder: "after-consonant" }, // visarga

  // --- Hasant / virama (no reorder) ---
  { match: "&", unicode: "্", reorder: "none" },

  // --- Vowel signs (kar) ---
  { match: "v", unicode: "া", reorder: "after-consonant" },
  { match: "wt", unicode: "ি", reorder: "before-consonant" },
  { match: "x", unicode: "ী", reorder: "after-consonant" },
  { match: "y", unicode: "ু", reorder: "after-consonant" },
  { match: "~y", unicode: "ূ", reorder: "after-consonant" },
  { match: "„", unicode: "ৃ", reorder: "after-consonant" },
  { match: "†t", unicode: "ে", reorder: "before-consonant" },
  { match: "‰t", unicode: "ৈ", reorder: "before-consonant" },
  { match: "†tv", unicode: "ো", reorder: "before-consonant" },
  { match: "․tv", unicode: "ৌ", reorder: "before-consonant" },

  // --- Reph ---
  { match: "©", unicode: "র্", reorder: "reph" },

  // --- Digits ---
  { match: "0", unicode: "০" },
  { match: "1", unicode: "১" },
  { match: "2", unicode: "২" },
  { match: "3", unicode: "৩" },
  { match: "4", unicode: "৪" },
  { match: "5", unicode: "৫" },
  { match: "6", unicode: "৬" },
  { match: "7", unicode: "৭" },
  { match: "8", unicode: "৮" },
  { match: "9", unicode: "৯" },
];
