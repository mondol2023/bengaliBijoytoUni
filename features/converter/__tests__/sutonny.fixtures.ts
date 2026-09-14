import type { ConversionFixture } from "./bijoy.fixtures";

/**
 * Same verification caveat as `bijoy.fixtures.ts`: internally consistent
 * with `encodings/sutonny/map.ts`'s current provisional rule table, not yet
 * confirmed against real SutonnyMJ-encoded documents.
 */
export const sutonnyFixtures: ConversionFixture[] = [
  { description: "independent vowel", input: "A", expected: "অ" },
  { description: "plain consonant", input: "K", expected: "ক" },
  {
    description: "single-char rule wins when the longer overlapping rule doesn't match",
    input: "w",
    expected: "দ",
  },
  {
    description: "longest-match wins over an overlapping shorter rule (wt vs w)",
    input: "wtK",
    expected: "কি",
  },
  {
    description: "reph typed after its consonant, reordered before",
    input: "K©",
    expected: "র্ক",
  },
  {
    description: "digits",
    input: "0123456789",
    expected: "০১২৩৪৫৬৭৮৯",
  },
];
