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
 * Entries below are what that sample proves, plus the ৎ/ঃ/ঁ tail slots,
 * which a later user document raised as unmapped and which are pinned by
 * structural alignment against a second layout rather than guessed — see
 * the note on them below. Bytes still unaccounted for (the "t" slot, most
 * conjuncts, the second halves of the ু/ূ/ৃ byte pairs) are deliberately
 * absent rather than guessed: they will surface as unmapped warnings, which
 * is actionable. Add them from new samples.
 *
 * When a real document raises unmapped bytes here, the report from
 * `engine/validate.ts` now names each one's position and the converted text
 * around it, which is what turns "byte Ê is unmapped" into a fixture.
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
  // r/s were first entered as ড়/ঢ় by slot position; real court text proves
  // otherwise: "h¡c£fr" is বাদীপক্ষ, "fË¢af¢r" প্রতিপক্ষ, "rja¡" ক্ষমতা, and
  // "Mps¡" খসড়া, "L¡WNs¡u" কাঠগড়ায়. ক্ষ sits in this slot as a unit, the
  // way many legacy layouts treat it as a letter of its own.
  { match: "r", unicode: "ক্ষ" },
  { match: "s", unicode: "ড়" },
  { match: "u", unicode: "য়" },

  // --- Post-base marks ---
  // ৎ/ঃ/ঁ were absent until a user document raised them as unmapped. They
  // are not guesses: this layout's tail was pinned by aligning it against
  // the Boishakhi table in banglakit/bondhon (MIT), which is the same
  // alphabetic-order family shifted one slot earlier (Boishakhi spells আ as
  // the digraph "Aw"; this layout gives আ its own byte "B"). Boishakhi runs
  // ...r=ড়, s=ঢ়, t=য়, u=ৎ, v=ং; here য়/ং sit one byte later at u/w, which
  // the fixtures independently confirm, as they do z=।. That brackets the
  // gaps: "v" falls between the confirmed য় and ং, and the canonical
  // varnamala tail there is য় ৎ ং ঃ ঁ — so v=ৎ, then x=ঃ and y=ঁ filling
  // the two slots between the confirmed ং and ।. "x" is one of the bytes
  // the user's document flagged, and ঃ is common in real Bangla text.
  //
  // "t" (between ঢ় and য়) is the one slot this derivation does NOT settle
  // — Boishakhi leaves its equivalent position empty — so it stays absent
  // and will keep surfacing as an unmapped warning, per the policy above.
  { match: "v", unicode: "ৎ" }, // khanda ta (derived — see note)
  { match: "w", unicode: "ং" }, // anusvara (confirmed by fixtures)
  { match: "x", unicode: "ঃ" }, // visarga (derived — see note)
  { match: "y", unicode: "ঁ" }, // chandrabindu (derived — see note)

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

  // --- The same pairs after a copy path folded ²/¹ into plain 2/1 ---
  // Word and some PDF/clipboard paths apply compatibility normalization
  // (NFKC), which turns the superscript second byte into an ordinary digit:
  // a user's court order arrived as "Eš2" / "hš2hÉ" for উক্ত / বক্তব্য. A
  // digit glued to one of these conjunct bytes is never a real numeral.
  { match: "š2", unicode: "ক্ত", reorder: "none" },
  { match: "œ2", unicode: "ক্র", reorder: "none" },
  { match: "Ù1", unicode: "স্ত", reorder: "none" },
  { match: "q2", unicode: "হ্ন", reorder: "none" },
  { match: "¿1", unicode: "ন্ত", reorder: "none" },

  // --- Whole sequences a PDF copy path scrambled (a 2019 suit plaint) ---
  // A zero-width below-base glyph emitted one slot late, sometimes after an
  // inserted space. Unlike the cases `rules.ts` repairs, the scrambled order
  // here still reads as valid typed order (মলূ, চ্র), so only the exact
  // sequence can be fixed. The same plaint also spells each word correctly
  // ("j§mÉ" মূল্য, "fÐQ¡l" প্রচার), which is what pins these.
  { match: "jm§ É", unicode: "মূল্য", reorder: "none" },
  { match: "jm§É", unicode: "মূল্য", reorder: "none" },
  { match: "fQÐ", unicode: "প্রচ", reorder: "none" },

  // --- Conjuncts from a second document (a 2019 High Court judgment) ---
  // Derived by aligning this table's output, byte by byte, against an
  // independent full transcription of the same judgment — not confirmed by
  // the document's owner the way the land-record paragraph was. Each entry
  // is backed by several distinct words; see the fixtures.
  { match: "q²", unicode: "হ্ন", reorder: "none" }, // ¢Q¢q²a চিহ্নিত
  { match: "Øq", unicode: "স্থ", reorder: "none" }, // EfØq¡fe উপস্থাপন
  { match: "¿¹", unicode: "ন্ত", reorder: "none" }, // ¢pÜ¡¿¹ সিদ্ধান্ত
  { match: "¿»", unicode: "ন্ত্র", reorder: "none" }, // j¿»Z¡mu মন্ত্রণালয়
  { match: "…l¦", unicode: "গুরু", reorder: "none" }, // …l¦aÄ গুরুত্ব (a bare … stays an ellipsis)
  // "~®" is ৈ in this document (l¡S~®e¢aL রাজনৈতিক) but is deliberately not
  // a rule: it is the only two-bytes-to-one-character entry, and it would
  // drop this table's minimum length ratio below 1, loosening the check in
  // lib/conversionFailures/resolutionValidator.ts. It surfaces as unmapped.
  { match: "š", unicode: "ত্ত", reorder: "none" }, // pÇf¢š সম্পত্তি
  { match: "Ü", unicode: "দ্ধ", reorder: "none" },
  { match: "Ÿ", unicode: "দ্দ", reorder: "none" }, // ®j¡LŸj¡ মোকদ্দমা
  { match: "‘", unicode: "জ্ঞ", reorder: "none" }, // ¢h‘ বিজ্ঞ
  { match: "ä", unicode: "ন্ড", reorder: "none" }, // m¡ä ল্যান্ড
  { match: "à", unicode: "দ্ব", reorder: "none" }, // à¡l¡ দ্বারা
  { match: "â", unicode: "দ্র", reorder: "none" }, // â¦a দ্রুত
  { match: "ø", unicode: "ষ্ট", reorder: "none" }, // l¡øÊ রাষ্ট্র
  { match: "ù", unicode: "ষ্ঠ", reorder: "none" }, // fË¢aù¡ প্রতিষ্ঠা
  { match: "ç", unicode: "প্ত", reorder: "none" }, // AhprfË¡ç অবসরপ্রাপ্ত
  { match: "æ", unicode: "ন্ন", reorder: "none" }, // ¢h¢iæ বিভিন্ন
  { match: "î", unicode: "ব্ব", reorder: "none" }, // eîC নব্বই
  { match: "’", unicode: "ঞ্চ", reorder: "none" }, // h’¢a বঞ্চিত
  { match: "ð", unicode: "ম্ব", reorder: "none" }, // ¢hm−ð বিলম্বে
  { match: "‹", unicode: "জ্জ", reorder: "none" }, // ¢ej‹¢a নিমজ্জিত
  { match: "‰", unicode: "ঙ্গ", reorder: "none" }, // fËp‰ প্রসঙ্গ
  { match: "ü", unicode: "স্ব", reorder: "none" }, // ü¡d£ea¡ স্বাধীনতা

  // Half forms: a consonant whose hasant joins it to the *next* token
  // (Çf -> ম্প). `engine/reorder.ts` keeps a token ending in ্ glued to
  // what follows, so a pre-base vowel or reph spans the whole cluster.
  { match: "Ø", unicode: "স্", reorder: "none" }, // ®l¢SØVÊ¡l রেজিস্ট্রার
  { match: "Ç", unicode: "ম্", reorder: "none" }, // pÇf¢š সম্পত্তি
  { match: "Ö", unicode: "ষ্", reorder: "none" }, // ¢eÖf¢š নিষ্পত্তি
  { match: "Ò", unicode: "ল্", reorder: "none" }, // L−Òf কল্পে
  { match: "¾", unicode: "ন্", reorder: "none" }, // Sh¡eh¢¾c জবানবন্দি
  { match: "µ", unicode: "চ্", reorder: "none" }, // k¡−µR যাচ্ছে
  // Visible hasant (এতদ্‌সংক্রান্ত); a doubled byte is one sign.
  { match: "ÚÚ", unicode: "্\u200C", reorder: "none" },
  { match: "Ú", unicode: "্\u200C", reorder: "none" },

  // Folas with more than one glyph width — the font picks the one that fits
  // under its base, so ্র alone has four bytes (Ð Ë Ê Ì).
  { match: "Ë", unicode: "্র", reorder: "none" }, // fËcn প্রদশ
  { match: "Ê", unicode: "্র", reorder: "none" }, // VÊ¡Ch¤e¡m ট্রাইব্যুনাল
  { match: "Ì", unicode: "্র", reorder: "none" }, // l¡øÌ£u রাষ্ট্রীয়
  { match: "Ä", unicode: "্ব", reorder: "none" }, // c¡¢uaÄ দায়িত্ব
  { match: "Å", unicode: "্ব", reorder: "none" },
  { match: "Æ", unicode: "্ব", reorder: "none" }, // pšÆ সত্ত্ব
  { match: "Ô", unicode: "্ল", reorder: "none" }, // pw¢nÔø সংশ্লিষ্ট
  { match: "À", unicode: "্ন", reorder: "none" }, // ¢ejÀ নিম্ন
  { match: "È", unicode: "্ম", reorder: "none" }, // pÈ¡lL স্মারক

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
  // The second ে byte (0xAD in the font) reaches us as whatever the copy
  // path made of it: U+2212 above, or the raw soft hyphen. Browsers often
  // drop a soft hyphen on copy, which is why pasted text from this layout
  // can be missing ে outright — nothing in the bytes is left to convert.
  { match: "\u00AD", unicode: "ে", reorder: "before-consonant" },
  { match: "¦", unicode: "ু", reorder: "after-consonant" }, // l¦ রু
  { match: "©", unicode: "ূ", reorder: "after-consonant" }, // l©f রূপ
  { match: "«", unicode: "ৃ", reorder: "after-consonant" }, // a«a£u তৃতীয়
  // ৌ is ে + base + this length mark; NFC composes the pair.
  { match: "±", unicode: "ৗ", reorder: "after-consonant" }, // ®Q±d¤l£ চৌধুরী
  { match: "°", unicode: "ৈ", reorder: "before-consonant" }, // °hWL বৈঠক
];
