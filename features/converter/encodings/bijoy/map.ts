import type { GlyphRule } from "../types";

/**
 * Bijoy Classic (SutonnyMJ-family) legacy-ASCII → Bengali-glyph table.
 *
 * Unlike the original placeholder this replaced, every `match`/`unicode`
 * pair here is a byte↔glyph correspondence cross-checked across multiple
 * independently-authored, published Bijoy-to-Unicode converters (their
 * table data only — no code or reordering logic was copied from any of
 * them; the reorder pass below is this project's own, driven by the
 * `reorder` flags per `engine/reorder.ts`):
 *
 *  - OpenBangla/poriborton (`src/bijoy2000.rs`, MIT) — an actively
 *    maintained Rust crate from the OpenBangla project (also behind
 *    OpenBangla-Keyboard), with its own unit-tested round-trip cases. Used
 *    as the primary source: it's the newest, most rigorously tested, and
 *    most permissively licensed of the sources found.
 *  - The classic 2009 "Bijoy to Unicode" JS table (by Abdullah Ibne Alam
 *    Shohag), as mirrored in several independent ports — used to
 *    corroborate the base letter/kar layout and a few bytes poriborton's
 *    table doesn't cover (see the Ð/Ñ note below). That lineage's own
 *    license (AGPL-3.0 on at least one mirror) is why only the factual
 *    byte↔glyph correspondence was used here, never its code.
 *  - mahabubulhasan/BijoyToUnicode (`bijoy2uni.js`, unlicensed) — a second,
 *    separately-authored port, used only where it agrees with the sources
 *    above (e.g. the standalone ja-fola/ra-fola bytes below) as a
 *    two-source-minimum bar before a byte↔glyph pair went into this table.
 *  - banglakit/bondhon (`bijoy_classic.py`, MIT) and Al-Shahrior/
 *    Bangla-Unicode-to-ANSI (`addons/U2B/u2b_class.gd`, GPL-3.0) — two later
 *    additions, both Unicode→ANSI. Neither is read directly; each is run
 *    backwards through this table's own pipeline (354 and 222 pairs) and only
 *    the mismatches are looked at. Same rule as the AGPL lineage above: the
 *    byte↔glyph facts only, and only where a second source agrees.
 *
 * The low Latin-1 range ¡¢£¤¥¦§®¯ was once left out of this table
 * entirely: only the AGPL lineage called those bytes standalone
 * hasant+consonant half-forms, and the other sources known at the time did
 * not have them even as compounds. Both later corpora do, so the half-form
 * block below now admits the ones that are safe to admit — but not all of
 * them, and for a different reason than before: seven of those bytes are
 * alpha-ANSI's vowel signs, and a one-byte rule for them would break
 * encoding detection. That block spells out which, and why.
 *
 * Source weighting, and why poriborton is no longer automatically primary:
 * two entries here were wrong in a way that only real documents expose.
 * Several SutonnyMJ conjunct glyphs are near-identical to an unrelated pair
 * of letters, and a table built by reading the font rather than typing it
 * records the look instead of the meaning: ক্ষ renders as ড় + ্গ, and the
 * wide প্ল renders as স্ন. poriborton/bahar decode "ÿ" as ড়্গ and "ø" as স্ন
 * accordingly — but ড়্গ is not a cluster that occurs in Bangla, and স্ন is
 * really "mœ", which every source lists separately. mahabubulhasan has the
 * meanings right ("ÿ" => ক্ষ; "cø"/"jø"/"kø" => প্ল/ল্ল/শ্ল), and real text
 * agrees, so on a disagreement of this shape a legacy document that decodes
 * to actual Bangla outranks source count. Where a disagreement is *not* of
 * that shape it is still left alone: "²" is ক্ষ্ম here and ক্ষ্ণ in bahar,
 * with no second source and no document either way, so it stands as-is.
 *
 * Still marked `experimental` (see `../bijoy/index.ts`) pending validation
 * against a larger corpus of real Bijoy-encoded documents — this fixes the
 * "wrong scheme entirely" problem the previous placeholder had, but a
 * verified table can still have gaps for rarer conjuncts. Real cases this
 * gets wrong should become fixtures (`__tests__/bijoy.fixtures.ts`), then
 * table fixes, not silent patches.
 */
export const bijoyRules: GlyphRule[] = [
  // --- Independent vowels ---
  { match: "A", unicode: "অ" },
  { match: "Av", unicode: "আ" },
  { match: "B", unicode: "ই" },
  { match: "C", unicode: "ঈ" },
  { match: "D", unicode: "উ" },
  { match: "E", unicode: "ঊ" },
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
  { match: "T", unicode: "ঞ" },
  { match: "U", unicode: "ট" },
  { match: "V", unicode: "ঠ" },
  { match: "W", unicode: "ড" },
  { match: "X", unicode: "ঢ" },
  { match: "Y", unicode: "ণ" },
  { match: "Z", unicode: "ত" },
  { match: "_", unicode: "থ" },
  { match: "`", unicode: "দ" },
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
  { match: "o", unicode: "ড়" },
  { match: "p", unicode: "ঢ়" },
  // Alternate ঢ় spelling: banglakit/bondhon (MIT) emits "~p" for ঢ়, where
  // "~" is otherwise the ূ-kar. Safe as a longest match because a ূ-kar can
  // never legitimately precede ঢ় with no base consonant of its own — the
  // sequence is only producible as this digraph. Without it "~p" decoded to
  // ূঢ়.
  { match: "~p", unicode: "ঢ়" },
  { match: "q", unicode: "য়" },

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

  // --- Post-base marks (no reorder — same position legacy & Unicode) ---
  { match: "r", unicode: "ৎ" }, // khanda ta
  { match: "s", unicode: "ং" }, // anusvara
  { match: "t", unicode: "ঃ" }, // visarga
  { match: "u", unicode: "ঁ" }, // chandrabindu
  { match: "$", unicode: "৳" }, // taka sign

  // --- Hasant / virama (no reorder) ---
  // A bare hasant: "&" is genuinely dual-purpose here. It joins two
  // consonants into a conjunct wherever the font has no dedicated ligature
  // byte for that cluster (ক্খ has none in either corpus, and none below,
  // so "K&L" is the only way to write it) — and it also carries the handful
  // of clusters that Bangla orthography writes with a *visible* hasant,
  // which Unicode spells as hasant + ZWNJ (U+200C).
  //
  // The two cannot be told apart from the byte alone, only from which
  // consonants surround it, so the visible-hasant cases are identified by
  // their consonant pair in `rules.ts` rather than by a fixed list of whole
  // legacy sequences here. A whole-sequence rule cannot match "cO&w³" =
  // পঙ্‌ক্তি, because the pre-base "w" sits inside the cluster.
  { match: "&", unicode: "্", reorder: "none" },
  // "¯" (স্) has no standalone rule of its own — it only ever appears
  // inside compounds here — so this one still has to be spelled out whole.
  { match: "¯c&j", unicode: "স্প্‌ল", reorder: "none" },

  // --- Reph: typed after the consonant cluster it sits above ---
  { match: "©", unicode: "র্", reorder: "reph" },

  // --- Punctuation ---
  { match: "Ò", unicode: "“" },
  { match: "Ó", unicode: "”" },
  { match: "Ô", unicode: "‘" },
  { match: "Õ", unicode: "’" },
  { match: "|", unicode: "।" }, // dari (full stop)
  { match: "\\", unicode: "॥" }, // double dari
  // Ð/Ñ corroborated by only one of the cross-checked sources (as a dash);
  // the others don't map these bytes at all. Lower confidence than the rest
  // of this table — flag first if a real sample disagrees.
  { match: "Ð", unicode: "-" },
  { match: "Ñ", unicode: "-" },

  // --- Vowel signs (kar) — reorder semantics are the point of these entries ---
  //
  // ো (o-kar) and ৌ (ou-kar) have no dedicated legacy byte of their own:
  // they're always typed as this pre-base ে/ঈ-kar byte, then the consonant,
  // then a trailing v/Š byte (e.g. "†Kv" for কো — verified against
  // poriborton's own round-trip tests). There's deliberately no composite
  // rule for that here: after the reorder pass below re-associates ে/ঈ with
  // its consonant, the assembled ে+consonant+v sequence is left for the
  // pipeline's final NFC normalization pass (`engine/normalize.ts`) to fold
  // into the single ো/ৌ codepoint — Unicode defines exactly that canonical
  // composition, so this table doesn't need to duplicate it.
  { match: "v", unicode: "া", reorder: "after-consonant" },
  { match: "w", unicode: "ি", reorder: "before-consonant" },
  { match: "x", unicode: "ী", reorder: "after-consonant" },
  { match: "y", unicode: "ু", reorder: "after-consonant" },
  { match: "z", unicode: "ু", reorder: "after-consonant" },
  // The third ু byte: the u-kar glyph that hangs off র and off a
  // ra-/la-fola rather than sitting under a plain consonant, so a font
  // gives it its own slot. It was missing until a second corpus
  // (OpenBangla/poriborton, MIT) round-tripped through this table:
  // "i“×" = রুদ্ধ, "aª“e" = ধ্রুব, "Avc­“Z" = আপ্লুত — every
  // one of its eight occurrences there decodes with ু in this position,
  // and banglakit/bondhon (MIT) lists "i“" => রু independently, so the
  // two-source bar is met. The byte carries no other meaning in this
  // family, hence a plain standalone rule rather than compounds.
  { match: "“", unicode: "ু", reorder: "after-consonant" },
  { match: "„", unicode: "ৃ", reorder: "after-consonant" },
  { match: "…", unicode: "ৃ", reorder: "after-consonant" },
  { match: "~", unicode: "ূ", reorder: "after-consonant" },
  { match: "ƒ", unicode: "ূ", reorder: "after-consonant" },
  { match: "‚", unicode: "ূ", reorder: "after-consonant" },
  { match: "†", unicode: "ে", reorder: "before-consonant" },
  { match: "‡", unicode: "ে", reorder: "before-consonant" },
  { match: "ˆ", unicode: "ৈ", reorder: "before-consonant" },
  { match: "‰", unicode: "ৈ", reorder: "before-consonant" },
  { match: "Š", unicode: "ৗ", reorder: "after-consonant" },

  // --- Fused consonant+vowel glyphs (dedicated single legacy byte) ---
  { match: "¸", unicode: "গু", reorder: "none" },
  { match: "ï", unicode: "শু", reorder: "none" },
  { match: "û", unicode: "হু", reorder: "none" },
  { match: "ü", unicode: "হৃ", reorder: "none" },
  { match: "i“", unicode: "রু", reorder: "none" },
  { match: "iƒ", unicode: "রূ", reorder: "none" },
  { match: "o–", unicode: "ড়ু", reorder: "none" },

  // --- Standalone fola marks ---
  // ja-fola (্য) and ra-fola (্র) also exist as dedicated legacy bytes in
  // their own right, not just baked into the fixed conjunct list below.
  // Real Bijoy text attaches them to whatever consonant precedes them (e.g.
  // a consonant with no hardcoded ...+fola entry below), so these act as a
  // generic fallback: longest-match-first still prefers the explicit
  // multi-byte conjuncts above when one exists (e.g. "Lª" -> "খ্র" beats
  // "L"+"ª" separately), and only falls back to plain concatenation
  // (consonant + ্য/্র) otherwise. Corroborated by two independent sources
  // (bahar/BijoyToUnicode and mahabubulhasan/BijoyToUnicode); "«" duplicates
  // "ª" in both — an alternate keyboard byte for the same glyph.
  { match: "¨", unicode: "্য", reorder: "none" }, // ja-fola
  { match: "ª", unicode: "্র", reorder: "none" }, // ra-fola
  { match: "«", unicode: "্র", reorder: "none" }, // ra-fola (alt byte)
  // "Ö" is the ra-fola byte real SutonnyMJ text actually uses after most
  // consonants ("cÖ", "MÖ", "‡kÖwY"). It was previously only reachable inside
  // the hardcoded "cÖ"/"MÖ"/"¯cÖ"/"®cÖ"/"¤cÖ" conjuncts, so anything else
  // ("kÖ" -> শ্র) left it unmapped. Standalone value confirmed by both
  // sources above ("Ö" => "্র" in each).
  { match: "Ö", unicode: "্র", reorder: "none" }, // ra-fola (alt byte)
  // "ø" is a la-fola glyph variant (the wide form, used under প/ল/শ), not
  // স্ন. The SutonnyMJ প্ল glyph is visually near-identical to স্ন, and the
  // poriborton/bahar lineage decodes it that way; mahabubulhasan instead
  // lists the compounds "cø" => প্ল, "jø" => ল্ল, "kø" => শ্ল, which is what
  // real text means — cf. "wW‡cøvgv" = ডিপ্লোমা in the fixtures. স্ন is "mœ"
  // (below), which both sources agree on, so the two are not in competition.
  { match: "ø", unicode: "্ল", reorder: "none" }, // la-fola (wide form)
  // The narrow la-fola byte was spelled three different ways in this file's
  // own conjunct block: cp1252 0xAC (U+00AC, NOT SIGN) in the K/d/f/n/m+la
  // conjuncts, cp1252 0xAD (U+00AD, SOFT HYPHEN) in the p/b ones, and
  // U+2212 (MINUS SIGN) in the g/l/sh/sp ones. Only the first two are cp1252
  // bytes at all, and banglakit/bondhon (MIT) uses 0xAD throughout, so the
  // U+2212 spellings were transcription errors; they have been corrected to
  // 0xAD in the conjunct block below.
  //
  // U+2212 is deliberately NOT accepted as an alias for it. That byte is
  // alpha-ANSI's e-kar (see `../alphaAnsi/map.ts`) and one of the commonest
  // characters in an alpha-ANSI document, so mapping it here would hand
  // Bijoy a large false-positive score on alpha-ANSI input —
  // `engine/detectEncoding.ts` measures exactly that, and its test caught
  // the first attempt at this fix.
  //
  // 0xAC and 0xAD both stand, because both genuinely occur in this font
  // family and neither byte carries any other meaning in this table. Making
  // la-fola compositional this way matches how ra-fola and ja-fola already
  // work; before it, the g/l/sh/h + 0xAD forms came out unmapped.
  { match: "¬", unicode: "্ল", reorder: "none" }, // la-fola (cp1252 0xAC)
  { match: "­", unicode: "্ল", reorder: "none" }, // la-fola (cp1252 0xAD)

  // --- Half-form bytes: the compositional layer under the conjunct list ---
  // Bijoy spells most conjuncts as a *pair* of glyph bytes: a leading
  // consonant-plus-hasant half-form, or a trailing hasant-plus-consonant
  // one, exactly as `¨`/`ª`/`Ö`/`¬` already work for the folas above. Until now
  // only the assembled pairs were listed, so any cluster the list happened
  // not to enumerate came out unmapped even though both halves were known.
  //
  // The header note above left these out as single-source. That no longer
  // holds: every value below is derivable from this file's own conjunct
  // rules (¯—=স্ত and š—=ন্ত force —=্ত whichever half you solve for), and each
  // one is independently attested in banglakit/bondhon (MIT) and
  // OpenBangla/poriborton (MIT). Al-Shahrior/Bangla-Unicode-to-ANSI
  // (`addons/U2B/u2b_class.gd`, GPL-3.0) is a third, separately-authored
  // lineage that lists them as half-forms outright; as with the AGPL
  // lineage noted above, only the byte↔glyph facts were taken from it, and
  // only where the two MIT corpora already agree. It is what exposed the
  // gap: round-tripping its 222 pairs through this table left 11 failures,
  // all of them clusters built from halves that were individually known.
  //
  // A leading half already carries its hasant and a trailing half carries
  // its own, so a pair of them meets in the middle with two. `rules.ts`
  // collapses that — Bangla never writes ্্ — which is what makes the two
  // halves genuinely compose instead of only working for pairs listed below.
  //
  // Deliberately absent, and these are the ones to check before adding a byte
  // here:
  //
  //  - ¡ ¢ £ ¤ ¥ § ® (্ব, ্ভ, ্ভ্র, ম্, ্ম, ্ম, ষ্). All well attested — ¡ alone
  //    appears in 25 corpus entries — and all still enumerated as pairs below,
  //    which is where they stay. Standalone they would wreck encoding
  //    detection: these seven bytes are alpha-ANSI's vowel signs (া ি ী ু ু ূ ে,
  //    see `../alphaAnsi/map.ts`), the commonest legacy bytes in such a
  //    document, so Bijoy would score ~0.70 legacy-range coverage on
  //    alpha-ANSI text instead of ~0.13. `engine/detectEncoding.ts` measures
  //    exactly that and `__tests__/conversion.test.ts` asserts it stays below
  //    0.3; adding them turned that assertion red, which is how the list above
  //    got trimmed. Same reasoning as the U+2212 la-fola note further up, and
  //    the same conclusion: a byte two encodings disagree about does not get a
  //    one-byte rule. ¦ and ^ are the ্ব forms that survive, because neither
  //    means anything in alpha-ANSI.
  //  - ‘ (U+2018), which the GPL table reads as ্তু but which neither MIT corpus
  //    contains at all. Single-source bytes stay out and keep surfacing as
  //    unmapped warnings, which is the actionable outcome.
  { match: "š", unicode: "ন্", reorder: "none" }, // ন + hasant
  { match: "¯", unicode: "স্", reorder: "none" }, // স + hasant
  { match: "˜", unicode: "দ্", reorder: "none" }, // দ + hasant

  { match: "‹", unicode: "্ক", reorder: "none" }, // hasant + ক
  { match: "Œ", unicode: "্ক্র", reorder: "none" }, // hasant + ক্র
  { match: "—", unicode: "্ত", reorder: "none" }, // hasant + ত
  { match: "¿", unicode: "্ত্র", reorder: "none" }, // hasant + ত্র
  { match: "’", unicode: "্থ", reorder: "none" }, // hasant + থ
  { match: "œ", unicode: "্ন", reorder: "none" }, // hasant + ন
  { match: "è", unicode: "্ণ", reorder: "none" }, // hasant + ণ
  { match: "ú", unicode: "্প", reorder: "none" }, // hasant + প
  { match: "^", unicode: "্ব", reorder: "none" }, // hasant + ব
  { match: "¦", unicode: "্ব", reorder: "none" }, // hasant + ব

  // --- Consonant conjuncts (each a dedicated legacy byte/sequence for a full cluster) ---
  { match: "°", unicode: "ক্ক", reorder: "none" },
  { match: "±", unicode: "ক্ট", reorder: "none" },
  { match: "±ª", unicode: "ক্ট্র", reorder: "none" },
  { match: "³", unicode: "ক্ত", reorder: "none" },
  { match: "³«", unicode: "ক্ত্র", reorder: "none" },
  { match: "Kè", unicode: "ক্ন", reorder: "none" },
  { match: "K¡", unicode: "ক্ব", reorder: "none" },
  { match: "´", unicode: "ক্ম", reorder: "none" },
  { match: "µ", unicode: "ক্র", reorder: "none" },
  { match: "K¬", unicode: "ক্ল", reorder: "none" },
  { match: "¶", unicode: "ক্ষ", reorder: "none" },
  // Second ক্ষ byte, and the same visual-decomposition trap as "ø" above:
  // the SutonnyMJ ক্ষ glyph reads as ড় + ্গ, and the poriborton/bahar
  // lineage decoded it as ড়্গ (a cluster that does not occur in Bangla).
  // mahabubulhasan has "ÿ" => ক্ষ; cf. "wkÿv" = শিক্ষা in the fixtures.
  { match: "ÿ", unicode: "ক্ষ", reorder: "none" },
  { match: "¶è", unicode: "ক্ষ্ণ", reorder: "none" },
  { match: "¶¡", unicode: "ক্ষ্ব", reorder: "none" },
  { match: "²", unicode: "ক্ষ্ম", reorder: "none" },
  { match: "·", unicode: "ক্স", reorder: "none" },
  { match: "Lª", unicode: "খ্র", reorder: "none" },
  { match: "»", unicode: "গ্ধ", reorder: "none" },
  { match: "»ª", unicode: "গ্ধ্র", reorder: "none" },
  { match: "Mœ", unicode: "গ্ন", reorder: "none" },
  { match: "M¦", unicode: "গ্ব", reorder: "none" },
  { match: "M¥", unicode: "গ্ম", reorder: "none" },
  { match: "MÖ", unicode: "গ্র", reorder: "none" },
  { match: "M­", unicode: "গ্ল", reorder: "none" },
  { match: "Nœ", unicode: "ঘ্ন", reorder: "none" },
  { match: "Nª", unicode: "ঘ্র", reorder: "none" },
  { match: "¼", unicode: "ঙ্ক", reorder: "none" },
  { match: "•¶", unicode: "ঙ্ক্ষ", reorder: "none" },
  { match: "•L", unicode: "ঙ্খ", reorder: "none" },
  { match: "½", unicode: "ঙ্গ", reorder: "none" },
  { match: "•N", unicode: "ঙ্ঘ", reorder: "none" },
  { match: "•Nª", unicode: "ঙ্ঘ্র", reorder: "none" },
  { match: "•g", unicode: "ঙ্ম", reorder: "none" },
  { match: "”P", unicode: "চ্চ", reorder: "none" },
  { match: "”Q", unicode: "চ্ছ", reorder: "none" },
  { match: "”Q¡", unicode: "চ্ছ্ব", reorder: "none" },
  { match: "”Qª", unicode: "চ্ছ্র", reorder: "none" },
  { match: "”T", unicode: "চ্ঞ", reorder: "none" },
  { match: "”¡", unicode: "চ্ব", reorder: "none" },
  { match: "¾", unicode: "জ্জ", reorder: "none" },
  { match: "¾¡", unicode: "জ্জ্ব", reorder: "none" },
  { match: "À", unicode: "জ্ঝ", reorder: "none" },
  { match: "Á", unicode: "জ্ঞ", reorder: "none" },
  { match: "R¡", unicode: "জ্ব", reorder: "none" },
  { match: "Rª", unicode: "জ্র", reorder: "none" },
  { match: "Â", unicode: "ঞ্চ", reorder: "none" },
  { match: "Ã", unicode: "ঞ্ছ", reorder: "none" },
  { match: "Ä", unicode: "ঞ্জ", reorder: "none" },
  { match: "Å", unicode: "ঞ্ঝ", reorder: "none" },
  { match: "Æ", unicode: "ট্ট", reorder: "none" },
  { match: "U¡", unicode: "ট্ব", reorder: "none" },
  { match: "U¥", unicode: "ট্ম", reorder: "none" },
  { match: "Uª", unicode: "ট্র", reorder: "none" },
  { match: "Ç", unicode: "ড্ড", reorder: "none" },
  { match: "W¡", unicode: "ড্ব", reorder: "none" },
  { match: "W¥", unicode: "ড্ম", reorder: "none" },
  { match: "Wª", unicode: "ড্র", reorder: "none" },
  { match: "Xª", unicode: "ঢ্র", reorder: "none" },
  { match: "È", unicode: "ণ্ট", reorder: "none" },
  { match: "É", unicode: "ণ্ঠ", reorder: "none" },
  { match: "Ê", unicode: "ণ্ড", reorder: "none" },
  { match: "Êª", unicode: "ণ্ড্র", reorder: "none" },
  { match: "YX", unicode: "ণ্ঢ", reorder: "none" },
  { match: "Yè", unicode: "ণ্ণ", reorder: "none" },
  { match: "Y¡", unicode: "ণ্ব", reorder: "none" },
  { match: "Y¥", unicode: "ণ্ম", reorder: "none" },
  { match: "Ë", unicode: "ত্ত", reorder: "none" },
  { match: "Ë¡", unicode: "ত্ত্ব", reorder: "none" },
  { match: "Ë«", unicode: "ত্ত্র", reorder: "none" },
  { match: "Ì", unicode: "ত্থ", reorder: "none" },
  { match: "Zœ", unicode: "ত্ন", reorder: "none" },
  { match: "Z¡", unicode: "ত্ব", reorder: "none" },
  { match: "Í", unicode: "ত্ম", reorder: "none" },
  { match: "Î", unicode: "ত্র", reorder: "none" },
  { match: "_¡", unicode: "থ্ব", reorder: "none" },
  { match: "_ª", unicode: "থ্র", reorder: "none" },
  { match: "˜M", unicode: "দ্গ", reorder: "none" },
  { match: "™N", unicode: "দ্ঘ", reorder: "none" },
  { match: "Ï", unicode: "দ্দ", reorder: "none" },
  { match: "Ï¡", unicode: "দ্দ্ব", reorder: "none" },
  { match: "×", unicode: "দ্ধ", reorder: "none" },
  { match: "Ø", unicode: "দ্ব", reorder: "none" },
  { match: "™¢", unicode: "দ্ভ", reorder: "none" },
  { match: "™£", unicode: "দ্ভ্র", reorder: "none" },
  { match: "Ù", unicode: "দ্ম", reorder: "none" },
  { match: "`ª", unicode: "দ্র", reorder: "none" },
  { match: "aœ", unicode: "ধ্ন", reorder: "none" },
  { match: "aŸ", unicode: "ধ্ব", reorder: "none" },
  { match: "a¥", unicode: "ধ্ম", reorder: "none" },
  { match: "aª", unicode: "ধ্র", reorder: "none" },
  { match: "›U", unicode: "ন্ট", reorder: "none" },
  { match: "›Uª", unicode: "ন্ট্র", reorder: "none" },
  { match: "Ú", unicode: "ন্ঠ", reorder: "none" },
  { match: "Û", unicode: "ন্ড", reorder: "none" },
  { match: "Û¡", unicode: "ন্ড্ব", reorder: "none" },
  { match: "Ûª", unicode: "ন্ড্র", reorder: "none" },
  { match: "š—", unicode: "ন্ত", reorder: "none" },
  { match: "š—¡", unicode: "ন্ত্ব", reorder: "none" },
  { match: "š¿", unicode: "ন্ত্র", reorder: "none" },
  { match: "š’", unicode: "ন্থ", reorder: "none" },
  { match: "š’ª", unicode: "ন্থ্র", reorder: "none" },
  { match: "›`", unicode: "ন্দ", reorder: "none" },
  { match: "›Ø", unicode: "ন্দ্ব", reorder: "none" },
  { match: "›`ª", unicode: "ন্দ্র", reorder: "none" },
  { match: "Ü", unicode: "ন্ধ", reorder: "none" },
  { match: "Üª", unicode: "ন্ধ্র", reorder: "none" },
  { match: "bœ", unicode: "ন্ন", reorder: "none" },
  { match: "š^", unicode: "ন্ব", reorder: "none" },
  { match: "b¥", unicode: "ন্ম", reorder: "none" },
  { match: "Ý", unicode: "ন্স", reorder: "none" },
  { match: "›n", unicode: "ন্হ", reorder: "none" },
  { match: "Þ", unicode: "প্ট", reorder: "none" },
  { match: "ß", unicode: "প্ত", reorder: "none" },
  { match: "cœ", unicode: "প্ন", reorder: "none" },
  { match: "à", unicode: "প্প", reorder: "none" },
  { match: "cÖ", unicode: "প্র", reorder: "none" },
  { match: "c­", unicode: "প্ল", reorder: "none" },
  { match: "á", unicode: "প্স", reorder: "none" },
  { match: "d«", unicode: "ফ্র", reorder: "none" },
  { match: "d¬", unicode: "ফ্ল", reorder: "none" },
  { match: "â", unicode: "ব্জ", reorder: "none" },
  { match: "ã", unicode: "ব্দ", reorder: "none" },
  { match: "ä", unicode: "ব্ধ", reorder: "none" },
  { match: "eŸ", unicode: "ব্ব", reorder: "none" },
  { match: "eª", unicode: "ব্র", reorder: "none" },
  { match: "e­", unicode: "ব্ল", reorder: "none" },
  { match: "f¡", unicode: "ভ্ব", reorder: "none" },
  { match: "å", unicode: "ভ্র", reorder: "none" },
  { match: "f¬", unicode: "ভ্ল", reorder: "none" },
  { match: "æ", unicode: "ম্ন", reorder: "none" },
  { match: "¤c", unicode: "ম্প", reorder: "none" },
  { match: "¤cÖ", unicode: "ম্প্র", reorder: "none" },
  // "ú" is the other ্প half-form byte (the one real SutonnyMJ text uses:
  // "Kw¤úDUvi" = কম্পিউটার). bahar has "ú" => ্প standalone;
  // mahabubulhasan has the compounds "¤ú"/"®ú"/"¯ú" => ম্প/ষ্প/স্প. Only the
  // compounds are listed, matching how the "¤c"/"®c"/"¯c" rows above are
  // written — a bare "ú" stays unmapped (and so stays a visible warning)
  // rather than emitting a stray hasant.
  { match: "¤ú", unicode: "ম্প", reorder: "none" },
  { match: "¤úÖ", unicode: "ম্প্র", reorder: "none" },
  { match: "ç", unicode: "ম্ফ", reorder: "none" },
  { match: "¤^", unicode: "ম্ব", reorder: "none" },
  { match: "¤^ª", unicode: "ম্ব্র", reorder: "none" },
  { match: "¤¢", unicode: "ম্ভ", reorder: "none" },
  { match: "¤£", unicode: "ম্ভ্র", reorder: "none" },
  { match: "¤§", unicode: "ম্ম", reorder: "none" },
  { match: "gª", unicode: "ম্র", reorder: "none" },
  { match: "¤¬", unicode: "ম্ল", reorder: "none" },
  { match: "é", unicode: "ল্ক", reorder: "none" },
  { match: "ê", unicode: "ল্গ", reorder: "none" },
  { match: "ë", unicode: "ল্ট", reorder: "none" },
  { match: "ì", unicode: "ল্ড", reorder: "none" },
  { match: "í", unicode: "ল্প", reorder: "none" },
  { match: "î", unicode: "ল্ফ", reorder: "none" },
  { match: "j¡", unicode: "ল্ব", reorder: "none" },
  { match: "j¢", unicode: "ল্ভ", reorder: "none" },
  { match: "j¥", unicode: "ল্ম", reorder: "none" },
  { match: "j­", unicode: "ল্ল", reorder: "none" },
  { match: "ð", unicode: "শ্চ", reorder: "none" },
  { match: "ñ", unicode: "শ্ছ", reorder: "none" },
  { match: "kœ", unicode: "শ্ন", reorder: "none" },
  { match: "k¦", unicode: "শ্ব", reorder: "none" },
  { match: "k¥", unicode: "শ্ম", reorder: "none" },
  { match: "kª", unicode: "শ্র", reorder: "none" },
  { match: "k­", unicode: "শ্ল", reorder: "none" },
  { match: "®‹", unicode: "ষ্ক", reorder: "none" },
  { match: "®‹¡", unicode: "ষ্ক্ব", reorder: "none" },
  { match: "®Œ", unicode: "ষ্ক্র", reorder: "none" },
  { match: "ó", unicode: "ষ্ট", reorder: "none" },
  { match: "óª", unicode: "ষ্ট্র", reorder: "none" },
  { match: "ô", unicode: "ষ্ঠ", reorder: "none" },
  { match: "ò", unicode: "ষ্ণ", reorder: "none" },
  { match: "ò¡", unicode: "ষ্ণ্ব", reorder: "none" },
  { match: "®c", unicode: "ষ্প", reorder: "none" },
  { match: "®cÖ", unicode: "ষ্প্র", reorder: "none" },
  { match: "®ú", unicode: "ষ্প", reorder: "none" },
  { match: "®úÖ", unicode: "ষ্প্র", reorder: "none" },
  { match: "õ", unicode: "ষ্ফ", reorder: "none" },
  { match: "®^", unicode: "ষ্ব", reorder: "none" },
  { match: "®§", unicode: "ষ্ম", reorder: "none" },
  { match: "¯‹", unicode: "স্ক", reorder: "none" },
  { match: "¯Œ", unicode: "স্ক্র", reorder: "none" },
  { match: "ö", unicode: "স্খ", reorder: "none" },
  { match: "÷", unicode: "স্ট", reorder: "none" },
  { match: "÷ª", unicode: "স্ট্র", reorder: "none" },
  { match: "¯—", unicode: "স্ত", reorder: "none" },
  { match: "¯—¡", unicode: "স্ত্ব", reorder: "none" },
  { match: "¯¿", unicode: "স্ত্র", reorder: "none" },
  { match: "¯’", unicode: "স্থ", reorder: "none" },
  // স্ন is "m" + the ্ন half-form "œ", matching the "Mœ"/"bœ"/"cœ"/"kœ"
  // family above; both sources agree (mahabubulhasan lists "mœ" outright,
  // bahar composes it from "m" => স and "œ" => ্ন). The byte previously
  // mapped here, "ø", is la-fola — see the standalone fola block.
  { match: "mœ", unicode: "স্ন", reorder: "none" },
  { match: "¯c", unicode: "স্প", reorder: "none" },
  { match: "¯cÖ", unicode: "স্প্র", reorder: "none" },
  { match: "¯c­", unicode: "স্প্ল", reorder: "none" },
  { match: "¯ú", unicode: "স্প", reorder: "none" },
  { match: "¯úÖ", unicode: "স্প্র", reorder: "none" },
  { match: "ù", unicode: "স্ফ", reorder: "none" },
  { match: "¯^", unicode: "স্ব", reorder: "none" },
  { match: "¯§", unicode: "স্ম", reorder: "none" },
  { match: "mª", unicode: "স্র", reorder: "none" },
  { match: "¯¬", unicode: "স্ল", reorder: "none" },
  { match: "nœ", unicode: "হ্ণ", reorder: "none" },
  { match: "ý", unicode: "হ্ন", reorder: "none" },
  { match: "nŸ", unicode: "হ্ব", reorder: "none" },
  { match: "þ", unicode: "হ্ম", reorder: "none" },
  { match: "nª", unicode: "হ্র", reorder: "none" },
  { match: "n¬", unicode: "হ্ল", reorder: "none" },
];
