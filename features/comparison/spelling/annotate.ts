import type { DiffResult } from "../engine/types";
import { findMisspellings } from "./checkSpelling";
import type { Misspelling, SegmentMark, SideSpelling, SpellChecker } from "./types";

/** Marks inside `list` that overlap `[from, to)`, clipped and made relative to `from`. */
function marksWithin(list: Misspelling[], from: number, to: number): SegmentMark[] {
  const marks: SegmentMark[] = [];
  for (const { word, start, end } of list) {
    if (end <= from) continue;
    if (start >= to) break;
    marks.push({ word, start: Math.max(start, from) - from, end: Math.min(end, to) - from });
  }
  return marks;
}

function reconstructs(result: DiffResult, source: string, target: string): boolean {
  let rebuiltSource = "";
  let rebuiltTarget = "";
  for (const { type, value } of result.segments) {
    if (type !== "added") rebuiltSource += value;
    if (type !== "removed") rebuiltTarget += value;
  }
  return rebuiltSource === source && rebuiltTarget === target;
}

/**
 * For each of `result.segments`, the misspelled words inside its `value`.
 *
 * Word mode: the segments of a word diff concatenate back to exactly the
 * source (unchanged + removed) and the target (unchanged + added), so the
 * whole-text findings — which saw each word's full context, such as the
 * `12/` and `2020` halves of one case number — are mapped over by offset.
 *
 * Paragraph mode (segments are whole paragraphs, trimmed, so offsets do not
 * map), or any text that does not rebuild exactly: each segment is checked
 * on its own. A paragraph is self-contained, so little context is lost.
 */
export function annotateSegments(
  result: DiffResult,
  source: { text: string; spelling: SideSpelling },
  target: { text: string; spelling: SideSpelling },
  checker: SpellChecker,
): SegmentMark[][] {
  const bothSkipped = source.spelling.skipped !== null && target.spelling.skipped !== null;
  if (bothSkipped) return result.segments.map(() => []);

  if (result.mode === "word" && reconstructs(result, source.text, target.text)) {
    let sourceOffset = 0;
    let targetOffset = 0;

    return result.segments.map(({ type, value }) => {
      const length = value.length;
      let marks: SegmentMark[];

      if (type === "removed") {
        marks = marksWithin(source.spelling.misspellings, sourceOffset, sourceOffset + length);
      } else if (type === "added") {
        marks = marksWithin(target.spelling.misspellings, targetOffset, targetOffset + length);
      } else if (target.spelling.skipped === null) {
        marks = marksWithin(target.spelling.misspellings, targetOffset, targetOffset + length);
      } else {
        marks = marksWithin(source.spelling.misspellings, sourceOffset, sourceOffset + length);
      }

      if (type !== "added") sourceOffset += length;
      if (type !== "removed") targetOffset += length;
      return marks;
    });
  }

  return result.segments.map(({ type, value }) => {
    // An unchanged segment exists on both sides; it is only skipped when both were (handled above).
    const skipped =
      type === "removed" ? source.spelling.skipped : type === "added" ? target.spelling.skipped : null;
    if (skipped) return [];
    return findMisspellings(value, checker).map(({ word, start, end }) => ({ word, start, end }));
  });
}

export interface TextPiece {
  text: string;
  /** Present when this piece is a flagged word. */
  mark?: SegmentMark;
}

/** Cuts `value` into plain and flagged pieces that rejoin to `value` exactly. */
export function splitByMarks(value: string, marks: SegmentMark[]): TextPiece[] {
  if (marks.length === 0) return [{ text: value }];

  const pieces: TextPiece[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) pieces.push({ text: value.slice(cursor, mark.start) });
    pieces.push({ text: value.slice(mark.start, mark.end), mark });
    cursor = mark.end;
  }
  if (cursor < value.length) pieces.push({ text: value.slice(cursor) });
  return pieces;
}
