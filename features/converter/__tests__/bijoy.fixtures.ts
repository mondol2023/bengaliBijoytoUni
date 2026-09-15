/**
 * Verified (input → expected output) cases for the Bijoy encoding, checked
 * against `features/converter/encodings/bijoy/map.ts`'s cross-referenced
 * rule table (see that file's doc comment for sources). The round-trip
 * cases below are carried over from OpenBangla/poriborton's own unit tests
 * (MIT-licensed; direction inverted, since that crate converts the other
 * way, Unicode → Bijoy) — those are genuine known-correct pairs, not just
 * internally-consistent-with-itself placeholders. Cases without that
 * provenance are still only as verified as the rule table underneath them.
 * Real cases this gets wrong should be added here and fixed in `map.ts`
 * together, per that file's doc comment.
 */

export interface ConversionFixture {
  description: string;
  input: string;
  expected: string;
}

export const bijoyFixtures: ConversionFixture[] = [
  { description: "independent vowel", input: "A", expected: "অ" },
  { description: "multi-char independent vowel (longest match)", input: "Av", expected: "আ" },
  { description: "plain consonant", input: "K", expected: "ক" },
  {
    description: "consonant + after-consonant kar (no reorder needed)",
    input: "Kv",
    expected: "কা",
  },
  {
    description: "before-consonant vowel sign typed before its consonant, reordered after",
    input: "wK",
    expected: "কি",
  },
  {
    description: "reph typed after its consonant, reordered before",
    input: "K©",
    expected: "র্ক",
  },
  {
    description: "hasant forms a conjunct between two consonants",
    input: "K&L",
    expected: "ক্খ",
  },
  {
    description: "anusvara after consonant",
    input: "Ks",
    expected: "কং",
  },
  {
    description: "chandrabindu after consonant",
    input: "Ku",
    expected: "কঁ",
  },
  {
    description: "digits",
    input: "0123456789",
    expected: "০১২৩৪৫৬৭৮৯",
  },
  {
    description: "whitespace passthrough between words",
    input: "K L",
    expected: "ক খ",
  },
  // --- Round-trip cases from OpenBangla/poriborton's test suite (MIT) ---
  { description: "poriborton: word with anusvara + visarga", input: "`ytL", expected: "দুঃখ" },
  { description: "poriborton: word with chandrabindu", input: "Pvu`", expected: "চাঁদ" },
  { description: "poriborton: word with reph", input: "AK©", expected: "অর্ক" },
  {
    description: "poriborton: full Bengali alphabet, vowels+consonants",
    input: "stAAvBCDEFGHIJKLMNOPQRSTUVWXYZ_`abcdefghijklmnpoqh",
    expected: "ংঃঅআইঈউঊঋএঐওঔকখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহঢ়ড়য়য",
  },
  {
    description: "poriborton: digits, taka sign, dari, double dari",
    input: "0123456789$|\\",
    expected: "০১২৩৪৫৬৭৮৯৳।॥",
  },
  {
    description: "poriborton: sentence with hasant-formed conjunct and o-kar",
    input: "evsjv Avgvi fvlv| Avwg evsjvq †`wL ¯^cœ!",
    expected: "বাংলা আমার ভাষা। আমি বাংলায় দেখি স্বপ্ন!",
  },
  { description: "poriborton: fused consonant+u-kar (কু)", input: "Kz", expected: "কু" },
  { description: "poriborton: fused গু glyph", input: "¸", expected: "গু" },
  { description: "poriborton: fused শু glyph", input: "ï", expected: "শু" },
  { description: "poriborton: fused হু glyph", input: "û", expected: "হু" },
  { description: "poriborton: fused রু glyph (র + ু)", input: "i“", expected: "রু" },
  { description: "poriborton: fused রূ glyph (র + ূ)", input: "iƒ", expected: "রূ" },
  { description: "poriborton: o-kar composite (ে + v)", input: "†Kv", expected: "কো" },
  { description: "poriborton: ou-kar composite (ে + Š)", input: "†KŠ", expected: "কৌ" },
  { description: "poriborton: dedicated ক্ষ conjunct byte", input: "¶", expected: "ক্ষ" },
  { description: "poriborton: dedicated জ্ঞ conjunct byte", input: "Á", expected: "জ্ঞ" },

  // --- Real document: a Bangladeshi govt job circular (SutonnyMJ) ---
  // The cases that first exposed the "ÿ"/"ø"/"Ö"/"¤ú" table bugs. Each of
  // these came out visibly wrong (শিড়্গা, ক¤িúউটার, ডিপেস্নামা, শেÖণি) or
  // raised an unmapped-character warning before the map.ts fixes.
  { description: "real doc: ক্ষ via the ÿ byte (not ড়্গ)", input: "wkÿv", expected: "শিক্ষা" },
  { description: "real doc: ম্প via the ¤ú half-form pair", input: "Kw¤úDUvi", expected: "কম্পিউটার" },
  { description: "real doc: প্ল via la-fola ø (not স্ন)", input: "wW‡cøvgv", expected: "ডিপ্লোমা" },
  { description: "real doc: স্ন via mœ, the byte pair that means it", input: "mœvb", expected: "স্নান" },
  { description: "real doc: শ্র via standalone ra-fola Ö", input: "‡kÖwY", expected: "শ্রেণি" },
  { description: "real doc: গ্র + reph-free ra-fola", input: "AMÖvwaKvi", expected: "অগ্রাধিকার" },
  { description: "real doc: ক্ত conjunct byte in context", input: "cÖhyw³", expected: "প্রযুক্তি" },
  { description: "real doc: ja-fola after a bare consonant", input: "Z_¨", expected: "তথ্য" },
  {
    description: "real doc: full circular sentence, ক্ষ + ম্প + প্ল + শ্র together",
    input: "wkÿv †evW© n‡Z Kw¤úDUvi wW‡cøvgv/mggvb MÖnY‡hvM¨ n‡e bv|",
    expected: "শিক্ষা বোর্ড হতে কম্পিউটার ডিপ্লোমা/সমমান গ্রহণযোগ্য হবে না।",
  },

  // --- Gaps found by round-tripping banglakit/bondhon's table (MIT) ---
  // Its 354 (Unicode, Bijoy-ASCII) pairs were fed through this pipeline;
  // 323 already matched, confirming most of the "missing" rules a naive
  // table diff reports are in fact composed by the generic fola/reph rules.
  // The cases below are the ones that genuinely came out wrong, each now
  // fixed in map.ts (or, for the reph forms, in engine/reorder.ts).
  { description: "bondhon: reph over a ja-fola cluster (was কর্্য)", input: "K¨©", expected: "র্ক্য" },
  { description: "bondhon: reph over ন্ত + ja-fola", input: "š—¨©", expected: "র্ন্ত্য" },
  { description: "bondhon: reph over ম + ja-fola", input: "g¨©", expected: "র্ম্য" },
  { description: "bondhon: la-fola via the 0xAD byte (was unmapped)", input: "M­", expected: "গ্ল" },
  { description: "bondhon: la-fola via the 0xAD byte, ল্ল", input: "j­", expected: "ল্ল" },
  { description: "bondhon: la-fola via the 0xAC byte, ক্ল", input: "K¬", expected: "ক্ল" },
  { description: "bondhon: alternate ঢ় spelling (was ূঢ়)", input: "~p", expected: "ঢ়" },
  { description: "bondhon: visible hasant keeps its ZWNJ, ল্‌ফ", input: "j&d", expected: "ল্‌ফ" },
  { description: "bondhon: visible hasant keeps its ZWNJ, ঙ্‌ক্ত", input: "O&³", expected: "ঙ্‌ক্ত" },

  // --- Gaps found by round-tripping OpenBangla/poriborton's tests (MIT) ---
  // A second, independent corpus: 677 (Unicode, Bijoy-ASCII) pairs taken
  // from that crate's own unit tests, which descend from Avro Keyboard's
  // implementation rather than from bondhon. 658 matched on the first run.
  // Of the 19 that did not, 15 are the deviations map.ts already argues for
  // deliberately (the U+2212 la-fola spelling it rejects to protect
  // encoding detection, plus "ÿ" => ক্ষ and "ø" => ্ল, where a legacy
  // document outranks a table that read the font instead of typing it).
  // The remaining four are fixed here.
  { description: "poriborton: ু via the “ byte, after র", input: "i“×", expected: "রুদ্ধ" },
  { description: "poriborton: ু via the “ byte, after a ra-fola", input: "aª“e", expected: "ধ্রুব" },
  { description: "poriborton: ু via the “ byte, after a la-fola", input: "Avc­“Z", expected: "আপ্লুত" },
  // The pre-base "w" sits between the hasant and the ক্ত it joins, so no
  // whole-sequence rule can see the pair. `bijoy/rules.ts` matches on the
  // consonants either side instead, skipping the vowel sign.
  { description: "poriborton: visible hasant split by a pre-base vowel", input: "cO&w³", expected: "পঙ্‌ক্তি" },

  // --- Half-forms composing, from the Al-Shahrior/Bangla-Unicode-to-ANSI diff ---
  // A third corpus (222 pairs, GPL-3.0 — facts only, and only where the two
  // MIT corpora already agree) round-tripped at 211/222. Every failure was a
  // cluster whose two halves `map.ts` already knew but whose assembled pair it
  // did not list, which is what the half-form block there now fixes. These five
  // are the ones it recovered; the rest stay unmapped on purpose (see that
  // block's "deliberately absent" note).
  { description: "half-form: ্ব via the ^ byte", input: "Y^", expected: "ণ্ব" },
  { description: "half-form: ্ব via the ¦ byte", input: "j¦", expected: "ল্ব" },
  { description: "half-form: ্ণ via the è byte", input: "nè", expected: "হ্ণ" },
  { description: "half-form: a leading দ্ half before a plain consonant", input: "˜N", expected: "দ্ঘ" },
  // Two halves meeting: "¯" is স্ and "­" is ্ল, so the naive concatenation
  // is স্্ল. `bijoy/rules.ts` collapses the doubled hasant.
  { description: "half-form: leading and trailing halves collapse one hasant", input: "¯­", expected: "স্ল" },
];
