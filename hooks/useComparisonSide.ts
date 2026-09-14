"use client";

import { useState } from "react";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { SupportedFileFormat } from "@/types/domain";

export type ComparisonInputMode = "text" | "file";

export interface ComparisonSideMeta {
  fileName: string;
  fileType: SupportedFileFormat;
  pageCount: number | null;
  notes: string[] | null;
}

type ExtractResponse =
  | ({ ok: true; text: string } & ComparisonSideMeta)
  | { ok: false; error: SafeErrorResponse };

const UNREACHABLE_ERROR: SafeErrorResponse = {
  code: "UNKNOWN_ERROR",
  message: "Could not reach the server — check your connection and try again.",
};

/**
 * One side (source or target) of a comparison: either pasted text, or a file
 * whose text is extracted server-side via `/api/documents/extract-text`.
 * Deliberately does not run extracted text through the Bijoy/SutonnyMJ
 * conversion pipeline — the comparison tool diffs whatever text it's given,
 * legacy-encoded or already Unicode, so extraction is as far as this goes.
 */
export function useComparisonSide() {
  const [mode, setMode] = useState<ComparisonInputMode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<ComparisonSideMeta | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<SafeErrorResponse | null>(null);

  async function selectFile(next: File | null) {
    setFile(next);
    setMeta(null);
    setError(null);
    setText("");
    if (!next) return;

    setIsExtracting(true);
    const body = new FormData();
    body.set("file", next);

    try {
      const response = await fetch("/api/documents/extract-text", { method: "POST", body });
      const payload = (await response.json()) as ExtractResponse;
      if (!payload.ok) {
        setError(payload.error);
        return;
      }
      setText(payload.text);
      setMeta({
        fileName: payload.fileName,
        fileType: payload.fileType,
        pageCount: payload.pageCount,
        notes: payload.notes,
      });
    } catch {
      setError(UNREACHABLE_ERROR);
    } finally {
      setIsExtracting(false);
    }
  }

  function clear() {
    setMode("text");
    setText("");
    setFile(null);
    setMeta(null);
    setError(null);
  }

  return { mode, setMode, text, setText, file, selectFile, meta, isExtracting, error, clear };
}

export type ComparisonSide = ReturnType<typeof useComparisonSide>;
