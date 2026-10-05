/**
 * Similarity helpers used both to score whole-document similarity and to
 * decide whether an adjacent removed+added chunk pair reads as one edit
 * ("modification") instead of two unrelated changes.
 *
 * Deliberately word-bag based (a Sørensen–Dice coefficient over word
 * multisets), not a character-level edit-distance metric: edit distance is
 * O(n·m), and paragraph-mode chunks can be as large as a whole tier's
 * character cap (up to 75,000 for "ultra") — an O(n²) comparison at that
 * size is a real latency/DoS risk. The word-bag approach is O(n) in the
 * number of words. The known tradeoff: a single-word typo fix (e.g. "teh" →
 * "the") shares no whole words, so it scores as unrelated rather than as one
 * modification. Same "shipped, not hidden" posture as the conversion
 * engine's mapping-accuracy gap — flagged here for the same reason.
 */

/** Lowercased word → occurrence count, for order-insensitive overlap comparison. */
function wordBag(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  const trimmed = text.trim();
  if (trimmed.length === 0) return bag;
  for (const word of trimmed.split(/\s+/u)) {
    const key = word.toLowerCase();
    bag.set(key, (bag.get(key) ?? 0) + 1);
  }
  return bag;
}

function bagSize(bag: Map<string, number>): number {
  let total = 0;
  for (const count of bag.values()) total += count;
  return total;
}

/**
 * Sørensen–Dice coefficient over word multisets: 2·|intersection| / (|a| + |b|).
 * 0 = nothing in common, 1 = identical bags of words (order-insensitive).
 * Two empty strings are treated as identical (1), matching how an
 * unchanged-but-empty document should compare.
 */
export function wordOverlapSimilarity(a: string, b: string): number {
  const bagA = wordBag(a);
  const bagB = wordBag(b);
  const totalA = bagSize(bagA);
  const totalB = bagSize(bagB);

  if (totalA === 0 && totalB === 0) return 1;
  if (totalA === 0 || totalB === 0) return 0;

  let intersection = 0;
  for (const [word, countA] of bagA) {
    const countB = bagB.get(word);
    if (countB) intersection += Math.min(countA, countB);
  }

  return (2 * intersection) / (totalA + totalB);
}

/**
 * Overall document similarity from word counts: the same Dice coefficient,
 * applied to (source word count, target word count, words the diff found
 * unchanged — counted once per side, same as a shared token would be).
 */
export function overallSimilarity(sourceWords: number, targetWords: number, unchangedWords: number): number {
  const total = sourceWords + targetWords;
  if (total === 0) return 1;
  return Math.min(1, (2 * unchangedWords) / total);
}
