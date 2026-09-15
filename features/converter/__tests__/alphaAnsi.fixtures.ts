import type { ConversionFixture } from "./bijoy.fixtures";

/**
 * Verified cases for the alphabetic ANSI layout (`encodings/alphaAnsi`).
 *
 * Unlike the other two fixture files, the long case at the bottom is real
 * provenance: a full paragraph from a Bangladeshi land-record order, paired
 * with the Unicode transcription its owner confirmed. The table in
 * `encodings/alphaAnsi/map.ts` was derived from that pair, so this fixture
 * is what makes it a verified table rather than a guess.
 */
export const alphaAnsiFixtures: ConversionFixture[] = [
  { description: "independent vowel আ has its own byte (not a digraph)", input: "B", expected: "আ" },
  { description: "consonant row starts one slot after Bijoy's", input: "L", expected: "ক" },
  { description: "consonant + aa-kar", input: "L¡", expected: "কা" },
  { description: "pre-base i-kar typed before its consonant", input: "¢L", expected: "কি" },
  { description: "pre-base e-kar typed before its consonant", input: "−L", expected: "কে" },
  { description: "o-kar is e-kar + consonant + aa-kar, folded by NFC", input: "−L¡", expected: "কো" },
  { description: "reph typed after its consonant", input: "LÑ", expected: "র্ক" },
  { description: "reph after a consonant that already took a kar", input: "j−jÑ", expected: "মর্মে" },
  { description: "ja-fola", input: "LÉ", expected: "ক্য" },
  { description: "ra-fola", input: "LÐ", expected: "ক্র" },
  { description: "below-base kar typed before an attached ja-fola", input: "a¥É", expected: "ত্যু" },
  { description: "dedicated ক্ত byte pair", input: "š²", expected: "ক্ত" },
  { description: "dedicated স্ত byte pair", input: "Ù¹", expected: "স্ত" },
  { description: "dari", input: "z", expected: "।" },

  // --- Post-base marks (the tail slots । see the note in alphaAnsi/map.ts) ---
  // ৎ/ঃ/ঁ were missing until a user's document flagged them as unmapped;
  // their bytes were pinned by aligning this layout's tail against Boishakhi
  // rather than guessed. য় and ং sit either side of them and are already
  // proved by the land-record paragraph below, so these cases lock the whole
  // run in place: a future edit that shifts one slot breaks them all.
  // য় is spelled য + ়, not U+09DF: the precomposed letter is a Unicode
  // composition exclusion, so NFC decomposes it and that is the form the
  // pipeline emits.
  { description: "য়, one byte after Boishakhi's", input: "eu", expected: "নয়" },
  { description: "khanda ta between the confirmed য় and ং", input: "qW¡v", expected: "হঠাৎ" },
  { description: "anusvara", input: "h¡wm¡", expected: "বাংলা" },
  { description: "visarga — one of the bytes the user's document flagged", input: "c¤xM", expected: "দুঃখ" },
  { description: "chandrabindu follows the vowel sign it sits over", input: "Q¡yc", expected: "চাঁদ" },
  { description: "digits", input: "0123456789", expected: "০১২৩৪৫৬৭৮৯" },
  {
    description: "real land-record paragraph round-trips to its confirmed transcription",
    input:
      "B−hceL¡l£l L¡NSfœ ®cMm¡j J hš²hÉ öem¡jz fkÑ¡−m¡Qe¡u ®cM¡ k¡u ®k, B−hceL¡l£ p¡−hL 1572 J 1659 c¡−Nl S¢j Na 17/01/1957 Cw a¡¢l−M 551 ew c¢mm J 30/12/1977 Cw a¡¢l−M 8979 ew c¢mm j§−m œ²u L−l −i¡N cMm B−Rez h¡c£ M¡¢lS L−le J M¡Se¡¢c f¢l−n¡d L−lez h¡c£l e¡−j c¢mm J cMm ®j¡a¡−hL ¢X¢f 585 J 592 ew M¢au¡e ®lLXÑ fÐÙ¹¤a Ll¡ quz",
    expected:
      "আবেদনকারীর কাগজপত্র দেখলাম ও বক্তব্য শুনলাম। পর্যালোচনায় দেখা যায় যে, আবেদনকারী সাবেক ১৫৭২ ও ১৬৫৯ দাগের জমি গত ১৭/০১/১৯৫৭ ইং তারিখে ৫৫১ নং দলিল ও ৩০/১২/১৯৭৭ ইং তারিখে ৮৯৭৯ নং দলিল মূলে ক্রয় করে ভোগ দখল আছেন। বাদী খারিজ করেন ও খাজনাদি পরিশোধ করেন। বাদীর নামে দলিল ও দখল মোতাবেক ডিপি ৫৮৫ ও ৫৯২ নং খতিয়ান রেকর্ড প্রস্তুত করা হয়।",
  },
  {
    description: "second half of the same paragraph, including reph and মৃত্যু",
    input:
      "¢hh¡c£ Na 22/03/1966 Cw a¡¢l−Ml 5410 ew c¢mm j§−m e¡¢mn£ p¡−hL 1572 J 1659 c¡−Nl 62 naL S¢j Hp,H, j¡¢mL S−mu¡ ®nM Hl ¢eLV qC−a M¢lc L−lez ¢hh¡c£l c¢m−ml c¡a¡ S−mu¡ ®nM Na 02/03/1957 Cw p−e jªa¥ÉhlZ L−l−Re j−jÑ ÙÛ¡e£u CE¢eue f¢loc ®Qu¡ljÉ¡e p¡¢VÑ¢g−LV fÐc¡e L−lez e¡¢mn£ S¢j h¡c£N−Zl ®i¡N cM−m B−Rz L¡NSfœ J cMm ®j¡a¡−hL f§−hÑl Ù¹−l p¢WL ¢hQ¡l e¡ qJu¡u A¢euj/a•La¡ q−u−R h−m fÐa£uj¡e j−e quz … p¡¢hÑL fkÑ¡−m¡Qe¡u ®cM¡ k¡u, 42(L) ¢h¢dl Ef¡c¡e B−Rz",
    expected:
      "বিবাদী গত ২২/০৩/১৯৬৬ ইং তারিখের ৫৪১০ নং দলিল মূলে নালিশী সাবেক ১৫৭২ ও ১৬৫৯ দাগের ৬২ শতক জমি এস,এ, মালিক জলেয়া শেখ এর নিকট হইতে খরিদ করেন। বিবাদীর দলিলের দাতা জলেয়া শেখ গত ০২/০৩/১৯৫৭ ইং সনে মৃত্যুবরণ করেছেন মর্মে স্থানীয় ইউনিয়ন পরিষদ চেয়ারম্যান সার্টিফিকেট প্রদান করেন। নালিশী জমি বাদীগণের ভোগ দখলে আছে। কাগজপত্র ও দখল মোতাবেক পূর্বের স্তরে সঠিক বিচার না হওয়ায় অনিয়ম/তঞ্চকতা হয়েছে বলে প্রতীয়মান মনে হয়। … সার্বিক পর্যালোচনায় দেখা যায়, ৪২(ক) বিধির উপাদান আছে।",
  },
];
