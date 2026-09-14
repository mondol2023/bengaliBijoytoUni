/** Framework-independent result shape produced by the comparison engine. */

export type DiffMode = "word" | "paragraph";

export type DiffSegmentType = "unchanged" | "added" | "removed";

export interface DiffSegment {
  type: DiffSegmentType;
  value: string;
  wordCount: number;
}

/**
 * A removal immediately followed by (or preceding) a related addition,
 * surfaced as one edit rather than two unrelated changes. `similarity` is
 * the word-overlap score that qualified the pair — useful for a UI that
 * wants to fade in low-confidence pairings differently from obvious ones.
 */
export interface DiffModification {
  removed: DiffSegment;
  added: DiffSegment;
  similarity: number;
}

export interface DiffStatistics {
  sourceWords: number;
  targetWords: number;
  changedWords: number;
}

export interface DiffResult {
  mode: DiffMode;
  /** Ordered exactly as the segments occur in the text — what a diff viewer renders inline. */
  segments: DiffSegment[];
  /** Same segments, bucketed by type for summaries/stats. Every segment appears in exactly one of these four plus `modifications`. */
  unchanged: DiffSegment[];
  additions: DiffSegment[];
  removals: DiffSegment[];
  modifications: DiffModification[];
  /** 0 (nothing in common) to 1 (identical). */
  similarity: number;
  statistics: DiffStatistics;
}
