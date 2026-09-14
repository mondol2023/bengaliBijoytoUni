"use client";

import { useState } from "react";
import { AUTO_DETECT, type EncodingChoice } from "@/features/converter/constants";
import type { ValidationResult } from "@/features/converter/engine/pipeline";
import type { UsageCheck } from "@/features/usage/usageService";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { TierId } from "@/types/domain";
import { useAuth } from "@/components/auth/AuthProvider";

export interface DocumentConversionResult {
  fileName: string;
  fileType: string;
  pageCount: number | null;
  notes: string[] | null;
  encodingId: string;
  detectionConfidence: number;
  unicodeText: string;
  validation: ValidationResult;
  usage: UsageCheck;
}

type ApiResponse = ({ ok: true } & DocumentConversionResult) | { ok: false; error: SafeErrorResponse };

const UNREACHABLE_ERROR: SafeErrorResponse = {
  code: "UNKNOWN_ERROR",
  message: "Could not reach the server — check your connection and try again.",
};

/**
 * Owns client-side document-upload state and talks to `/api/documents/extract`.
 * Extraction and conversion both run server-side (extraction libraries are
 * server-only); this hook is just the upload/result wiring for the UI.
 */
export function useDocumentConversion(initialTier: TierId = "easy") {
  const { user, profile, getIdToken } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [encodingChoice, setEncodingChoice] = useState<EncodingChoice>(AUTO_DETECT);
  const [tier, setTier] = useState<TierId>(initialTier);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<DocumentConversionResult | null>(null);
  const [error, setError] = useState<SafeErrorResponse | null>(null);

  // Signed-in callers always get their server-known account tier for this
  // route (the server ignores the client-supplied `tier` field entirely —
  // see /api/documents/extract) — the local `tier` state only matters while
  // signed out, where the server falls back to the default tier anyway.
  const effectiveTier = user && profile ? profile.tier : tier;

  async function convert() {
    if (!file) return;
    setStatus("uploading");
    setError(null);
    setResult(null);

    const body = new FormData();
    body.set("file", file);
    body.set("tier", effectiveTier);
    if (encodingChoice !== AUTO_DETECT) body.set("encodingId", encodingChoice);

    try {
      const idToken = user ? await getIdToken() : null;
      const response = await fetch("/api/documents/extract", {
        method: "POST",
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
        body,
      });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error);
        setStatus("error");
        return;
      }
      setResult(payload);
      setStatus("done");
    } catch {
      setError(UNREACHABLE_ERROR);
      setStatus("error");
    }
  }

  function selectFile(next: File | null) {
    setFile(next);
    setResult(null);
    setError(null);
    setStatus("idle");
  }

  function reset() {
    selectFile(null);
  }

  return {
    file,
    setFile: selectFile,
    encodingChoice,
    setEncodingChoice,
    tier: effectiveTier,
    setTier,
    // True once a signed-in profile is loaded — the tier picker should show
    // a locked account-tier badge instead of a free selector in that case.
    isTierLocked: Boolean(user && profile),
    status,
    isUploading: status === "uploading",
    result,
    error,
    convert,
    reset,
  };
}

export type UseDocumentConversionResult = ReturnType<typeof useDocumentConversion>;
