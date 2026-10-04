import type { SourceRun } from "@/features/converter/engine/fontRuns";
import type { SupportedFileFormat } from "@/types/domain";

export interface ExtractedDocument {
  text: string;
  fileName: string;
  fileType: SupportedFileFormat;
  /** PDF-specific: total page count, when known. */
  pageCount?: number;
  /** Non-fatal notes surfaced from the extractor (e.g. best-effort caveats, library warnings). */
  notes?: string[];
  /**
   * The same text cut into runs tagged with the font each was set in, when
   * the format carries font information (PDF, DOCX). Joins to `text` exactly.
   * Lets conversion leave English runs alone — see `engine/fontRuns.ts`.
   */
  runs?: SourceRun[];
  /** PDF-specific: pages that appear to draw their text as images (needs OCR). */
  imageTextPages?: number[];
}
