"use client";

import { useState } from "react";
import { AUTO_DETECT, type EncodingChoice } from "@/features/converter/constants";
import type { ValidationResult } from "@/features/converter/engine/pipeline";
import type { UsageCheck } from "@/features/usage/usageService";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import { DEFAULT_TIER } from "@/features/usage/tierConfig";
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
  const { user, profile, getIdToken, setAccountTier } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [encodingChoice, setEncodingChoice] = useState<EncodingChoice>(AUTO_DETECT);
  const [tier, setTier] = useState<TierId>(initialTier);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<DocumentConversionResult | null>(null);
  const [error, setError] = useState<SafeErrorResponse | null>(null);

  // The server ignores the client-supplied `tier` field entirely (see
  // /api/documents/extract): a signed-in caller gets their account tier, a
  // signed-out one always gets the default tier. Mirror that here so the
  // picker never shows (or the usage check never assumes) a tier the server
  // won't honour — a signed-out "Expert" selection used to be rejected at the
  // Easy limit with no explanation. The local `tier` state is only used while
  // signed in with the profile not yet loaded.
  const effectiveTier = !user ? DEFAULT_TIER : profile ? profile.tier : tier;

  /**
   * A signed-in user's tier lives on their account, so picking one here saves
   * it there (the same self-service write the Account page does) — otherwise
   * the picker would only ever echo a stored Easy tier with no way to raise it
   * from the page that reports the limit.
   */
  async function selectTier(next: TierId) {
    setTier(next);
    if (!user) return;
    const failure = await setAccountTier(next);
    if (failure) {
      setError(failure);
      setStatus("error");
    }
  }

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
    setTier: selectTier,
    // Only a signed-out caller is pinned (to the default tier). A signed-in
    // one picks freely and the choice is saved to their account.
    isTierLocked: !user,
    status,
    isUploading: status === "uploading",
    result,
    error,
    convert,
    reset,
  };
}

export type UseDocumentConversionResult = ReturnType<typeof useDocumentConversion>;
