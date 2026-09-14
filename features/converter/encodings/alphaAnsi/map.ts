import type { GlyphRule } from "../types";

/**
 * "Alphabetic ANSI" — a legacy Bengali ASCII layout that is NOT Bijoy.
 *
 * Unlike Bijoy/SutonnyMJ (which follows the Bijoy keyboard), this layout
 * assigns bytes in Bengali dictionary order: every independent vowel gets
 * its own byte (অ=A … ঔ=K), so the consonant row starts one slot later
 * (ক=L … হ=q) instead of Bijoy's ক=K … হ=n. Vowel signs live in the
 * Latin-1 range (া=¡, ি=¢, ী=£, ু=¤/¥, ূ=§, ৃ=ª, ে=®/−), reph is Ñ,
 * ja-fola É, ra-fola Ð, dari z. It shows up in older Bangladeshi
 * court/land-office documents; the vendor font name is unconfirmed.
 *
 * Because it overlaps Bijoy's byte range while meaning something completely
 * different, Bijoy's table "matches" ~72% of this text's bytes and produces
 * fluent-looking nonsense — which is why `engine/detectEncoding.ts` now
 * scores legacy-range (non-ASCII) coverage separately.
 *
 * Provenance: derived from a real document paired with its correct Unicode
 * transcription, then verified end-to-end — see
 * `__tests__/alphaAnsi.fixtures.ts`, which round-trips that full paragraph.
 * Entries below are exactly what that sample proves. Bytes the sample never
 * exercised (ৎ, ঃ, ঁ, most conjuncts, the second halves of the ু/ূ/ৃ byte
 * pairs) are deliberately absent rather than guessed: they will surface as
 * unmapped warnings, which is actionable. Add them from new samples.
 */
export const alphaAnsiRules: GlyphRule[] = [
  // --- Independent vowels (each has its own byte, unlike Bijoy's "Av") ---
  { match: "A", unicode: "অ" },
  { match: "B", unicode: "আ" },
  { match: "C", unicode: "ই" },
  { match: "D", unicode: "ঈ" },
  { match: "E", unicode: "উ" },
  { match: "F", unicode: "ঊ" },
  { match: "G", unicode: "ঋ" },
  { match: "H", unicode: "এ" },
  { match: "I", unicode: "ঐ" },
  { match: "J", unicode: "ও" },
  { match: "K", unicode: "ঔ" },

  // --- Consonants ---
  { match: "L", unicode: "ক" },
  { match: "M", unicode: "খ" },
  { match: "N", unicode: "গ" },
  { match: "O", unicode: "ঘ" },
  { match: "P", unicode: "ঙ" },
  { match: "Q", unicode: "চ" },
  { match: "R", unicode: "ছ" },
  { match: "S", unicode: "জ" },
  { match: "T", unicode: "ঝ" },
  { match: "U", unicode: "ঞ" },
  { match: "V", unicode: "ট" },
  { match: "W", unicode: "ঠ" },
  { match: "X", unicode: "ড" },
  { match: "Y", unicode: "ঢ" },
  { match: "Z", unicode: "ণ" },
  { match: "a", unicode: "ত" },
  { match: "b", unicode: "থ" },
  { match: "c", unicode: "দ" },
  { match: "d", unicode: "ধ" },
  { match: "e", unicode: "ন" },
  { match: "f", unicode: "প" },
  { match: "g", unicode: "ফ" },
  { match: "h", unicode: "ব" },
  { match: "i", unicode: "ভ" },
  { match: "j", unicode: "ম" },
  { match: "k", unicode: "য" },
  { match: "l", unicode: "র" },
  { match: "m", unicode: "ল" },
  { match: "n", unicode: "শ" },
  { match: "o", unicode: "ষ" },
  { match: "p", unicode: "স" },
  { match: "q", unicode: "হ" },
  { match: "r", unicode: "ড়" },
  { match: "s", unicode: "ঢ়" },
  { match: "u", unicode: "য়" },

  // --- Post-base marks ---
  { match: "w", unicode: "ং" },

  // --- Digits & dari ---
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
  { match: "z", unicode: "।" },

  // --- Hasant, folas, reph ---
  { match: "&", unicode: "্", reorder: "none" },
  { match: "É", unicode: "্য", reorder: "none" },
  { match: "Ð", unicode: "্র", reorder: "none" },
  { match: "Ñ", unicode: "র্", reorder: "reph" },

  // --- Conjuncts with a dedicated byte/sequence (longest match wins) ---
  { match: "š²", unicode: "ক্ত", reorder: "none" },
  { match: "œ²", unicode: "ক্র", reorder: "none" },
  { match: "œ", unicode: "ত্র", reorder: "none" },
  { match: "ÙÛ", unicode: "স্থ", reorder: "none" },
  { match: "Ù¹", unicode: "স্ত", reorder: "none" },
  { match: "•", unicode: "ঞ্চ", reorder: "none" },
  { match: "ö", unicode: "শু", reorder: "none" },

  // --- Vowel signs (kar) ---
  // ো/ৌ have no byte of their own: they are the pre-base ে byte, the
  // consonant, then ¡ — NFC folds ে+া into ো in `engine/normalize.ts`.
  { match: "¡", unicode: "া", reorder: "after-consonant" },
  { match: "¢", unicode: "ি", reorder: "before-consonant" },
  { match: "£", unicode: "ী", reorder: "after-consonant" },
  { match: "¤", unicode: "ু", reorder: "after-consonant" },
  { match: "¥", unicode: "ু", reorder: "after-consonant" },
  { match: "§", unicode: "ূ", reorder: "after-consonant" },
  { match: "ª", unicode: "ৃ", reorder: "after-consonant" },
  { match: "®", unicode: "ে", reorder: "before-consonant" },
  { match: "−", unicode: "ে", reorder: "before-consonant" },
];
