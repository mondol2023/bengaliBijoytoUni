import type { SupportedFileFormat } from "@/types/domain";

export interface ExtractedDocument {
  text: string;
  fileName: string;
  fileType: SupportedFileFormat;
  /** PDF-specific: total page count, when known. */
  pageCount?: number;
  /** Non-fatal notes surfaced from the extractor (e.g. best-effort caveats, library warnings). */
  notes?: string[];
}
