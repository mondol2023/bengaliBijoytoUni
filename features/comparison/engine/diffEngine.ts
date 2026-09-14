import { diffArrays, diffWordsWithSpace, type ArrayChange, type Change } from "diff";
import { countWords, splitParagraphs } from "@/lib/utils/text";
import { overallSimilarity, wordOverlapSimilarity } from "./similarity";
import type { DiffMode, DiffModification, DiffResult, DiffSegment, DiffSegmentType } from "./types";

/**
 * At or below this size (on both sides), an adjacent removed+added pair is
 * paired into a modification unconditionally — content-similarity is not a
 * meaningful signal for a short chunk (a date, a name, a single typo'd
 * word: "Monday" → "Tuesday" shares no words at all, but is unambiguously
 * one edit, not an unrelated delete-then-insert).
 */
const SHORT_CHUNK_WORD_LIMIT = 6;

/**
 * Above `SHORT_CHUNK_WORD_LIMIT`, an adjacent removed+added pair must clear
 * this word-overlap similarity to be treated as one modification rather
 * than two unrelated changes — this is what stops "paragraph deleted here,
 * unrelated new paragraph inserted right after it" from being mislabeled as
 * a rewording of the first paragraph. See `similarity.ts` for the
 * word-bag-overlap tradeoff this implies.
 */
const MODIFICATION_SIMILARITY_THRESHOLD = 0.3;

let wordSegmenter: Intl.Segmenter | undefined;

/**
 * jsdiff's default word tokenizer only groups runs of Latin-script
 * characters into a single "word" token (see its `extendedWordChars`
 * regex); every other character — Bengali included — falls through to a
 * one-character-at-a-time branch. Left alone, that would silently downgrade
 * word-mode diffing of Bengali text to near character-level diffing, which
 * is exactly the input this tool exists for. An `Intl.Segmenter` (supported
 * in both Node and browsers) does real word segmentation instead.
 */
function getWordSegmenter(): Intl.Segmenter {
  wordSegmenter ??= new Intl.Segmenter("bn", { granularity: "word" });
  return wordSegmenter;
}

/** A normalized change, independent of whether it came from a string diff or an array diff. */
interface RawChange {
  value: string;
  added: boolean;
  removed: boolean;
}

function fromChange(change: Change): RawChange {
  return { value: change.value, added: change.added ?? false, removed: change.removed ?? false };
}

function fromArrayChange(change: ArrayChange<string>, joiner: string): RawChange {
  return { value: change.value.join(joiner), added: change.added ?? false, removed: change.removed ?? false };
}

function toSegment(change: RawChange, type: DiffSegmentType): DiffSegment {
  return { type, value: change.value, wordCount: countWords(change.value) };
}

/**
 * Shared assembly: walks a flat change list (already normalized to
 * `RawChange`), pairs adjacent removed+added chunks that look related into
 * `DiffModification`s, buckets everything else, and computes statistics.
 * Both `compareWords` and `compareParagraphs` are thin adapters over this.
 */
function buildResult(mode: DiffMode, changes: RawChange[]): DiffResult {
  const segments: DiffSegment[] = [];
  const unchanged: DiffSegment[] = [];
  const additions: DiffSegment[] = [];
  const removals: DiffSegment[] = [];
  const modifications: DiffModification[] = [];

  let i = 0;
  while (i < changes.length) {
    const change = changes[i];

    if (!change.added && !change.removed) {
      const segment = toSegment(change, "unchanged");
      segments.push(segment);
      unchanged.push(segment);
      i++;
      continue;
    }

    const next = changes[i + 1];
    const isPair = next !== undefined && ((change.removed && next.added) || (change.added && next.removed));

    if (isPair && next) {
      const removedRaw = change.removed ? change : next;
      const addedRaw = change.added ? change : next;
      const removedWordCount = countWords(removedRaw.value);
      const addedWordCount = countWords(addedRaw.value);
      const isShortChunk = removedWordCount <= SHORT_CHUNK_WORD_LIMIT && addedWordCount <= SHORT_CHUNK_WORD_LIMIT;
      const similarity = wordOverlapSimilarity(removedRaw.value, addedRaw.value);

      if (isShortChunk || similarity >= MODIFICATION_SIMILARITY_THRESHOLD) {
        const firstSegment = toSegment(change, change.added ? "added" : "removed");
        const secondSegment = toSegment(next, next.added ? "added" : "removed");
        segments.push(firstSegment, secondSegment);
        modifications.push({
          removed: change.removed ? firstSegment : secondSegment,
          added: change.added ? firstSegment : secondSegment,
          similarity,
        });
        i += 2;
        continue;
      }
    }

    const segment = toSegment(change, change.added ? "added" : "removed");
    segments.push(segment);
    if (change.added) additions.push(segment);
    else removals.push(segment);
    i++;
  }

  // Derived from the segments themselves, not from independently re-tokenizing
  // `source`/`target` as whole strings: a word can straddle a diff boundary
  // (e.g. "file:" splits into a changed "file" token and an unchanged ":"
  // token), so per-segment counts and whole-string counts can legitimately
  // disagree. Building every count from the same segment-level tokenization
  // keeps `unchangedWords <= sourceWords/targetWords` true by construction,
  // which is what `overallSimilarity` relies on to never exceed 1.
  const unchangedWords = unchanged.reduce((sum, s) => sum + s.wordCount, 0);
  const removedWords = removals.reduce((sum, s) => sum + s.wordCount, 0);
  const addedWords = additions.reduce((sum, s) => sum + s.wordCount, 0);
  const modificationRemovedWords = modifications.reduce((sum, m) => sum + m.removed.wordCount, 0);
  const modificationAddedWords = modifications.reduce((sum, m) => sum + m.added.wordCount, 0);

  const sourceWords = unchangedWords + removedWords + modificationRemovedWords;
  const targetWords = unchangedWords + addedWords + modificationAddedWords;
  const changedWords = removedWords + addedWords + modificationRemovedWords + modificationAddedWords;

  return {
    mode,
    segments,
    unchanged,
    additions,
    removals,
    modifications,
    similarity: overallSimilarity(sourceWords, targetWords, unchangedWords),
    statistics: { sourceWords, targetWords, changedWords },
  };
}

/** Fine-grained, word-by-word comparison. The default mode. */
export function compareWords(source: string, target: string): DiffResult {
  const changes = diffWordsWithSpace(source, target, { intlSegmenter: getWordSegmenter() }).map(fromChange);
  return buildResult("word", changes);
}

/**
 * Coarser, whole-paragraph comparison — better for reviewing structural
 * rewrites (paragraphs reordered/rewritten wholesale) without a wall of
 * word-level noise. Paragraphs are the atomic unit: a paragraph counts as
 * changed even if only one word inside it differs.
 */
export function compareParagraphs(source: string, target: string): DiffResult {
  const sourceParagraphs = splitParagraphs(source);
  const targetParagraphs = splitParagraphs(target);
  const changes = diffArrays(sourceParagraphs, targetParagraphs).map((change) => fromArrayChange(change, "\n\n"));
  return buildResult("paragraph", changes);
}

/** Convenience dispatcher over the two modes, for call sites that pick the mode dynamically. */
export function compareText(mode: DiffMode, source: string, target: string): DiffResult {
  return mode === "word" ? compareWords(source, target) : compareParagraphs(source, target);
}

export type { DiffMode, DiffModification, DiffResult, DiffSegment, DiffSegmentType, DiffStatistics } from "./types";
