"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { AUTO_DETECT, type EncodingChoice } from "@/features/converter/constants";
import type { ValidationResult } from "@/features/converter/engine/pipeline";
import { isAiRecoverableFailure, needsAiFallback, type ConversionQuality } from "@/features/documents/quality";
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
  quality: ConversionQuality;
  imageTextPages: number[];
  unicodeText: string;
  validation: ValidationResult;
  usage: UsageCheck;
}

type ApiResponse = ({ ok: true } & DocumentConversionResult) | { ok: false; error: SafeErrorResponse };

export interface AiTranscriptionResult {
  text: string;
  truncated: boolean;
  model: string;
  /** "auto" when the engine's result fell below the quality bar; "manual" when the user asked. */
  trigger: "auto" | "manual";
}

type AiApiResponse =
  | { ok: true; text: string; truncated: boolean; provider: string; model: string }
  | { ok: false; error: SafeErrorResponse };

export type AiStatus = "idle" | "running" | "done" | "error" | "unavailable";

/** Per-browser preference, not account state: whether a low score may send the file to Gemini unasked. */
const AUTO_AI_STORAGE_KEY = "convert2uni:auto-ai-transcription";

const autoAiListeners = new Set<() => void>();

function readAutoAiPreference(): boolean {
  try {
    return window.localStorage.getItem(AUTO_AI_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribeAutoAi(listener: () => void) {
  autoAiListeners.add(listener);
  return () => autoAiListeners.delete(listener);
}

/** On by default: the server render and a browser with blocked storage both read "on". */
const autoAiServerSnapshot = () => true;

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
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiResult, setAiResult] = useState<AiTranscriptionResult | null>(null);
  const [aiError, setAiError] = useState<SafeErrorResponse | null>(null);
  const autoAi = useSyncExternalStore(subscribeAutoAi, readAutoAiPreference, autoAiServerSnapshot);
  // Each upload and each AI request gets a number; a response for an older
  // one (the user picked another file meanwhile) is dropped, not shown
  // against the wrong document.
  const requestSeq = useRef(0);

  function setAutoAi(next: boolean) {
    try {
      window.localStorage.setItem(AUTO_AI_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Private mode or blocked storage: the switch stays on, which the label shows.
    }
    autoAiListeners.forEach((listener) => listener());
  }

  function clearAi() {
    setAiStatus("idle");
    setAiResult(null);
    setAiError(null);
  }

  async function transcribe(target: File, trigger: AiTranscriptionResult["trigger"], seq: number) {
    setAiStatus("running");
    setAiError(null);
    setAiResult(null);

    const body = new FormData();
    body.set("file", target);
    try {
      const idToken = user ? await getIdToken() : null;
      const response = await fetch("/api/ai/transcribe", {
        method: "POST",
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
        body,
      });
      const payload = (await response.json()) as AiApiResponse;
      if (seq !== requestSeq.current) return;
      if (!payload.ok) {
        // Switched off on this deployment: an automatic attempt says nothing,
        // a click explains why nothing happened.
        if (payload.error.code === "NOT_FOUND_ERROR") {
          setAiStatus("unavailable");
          if (trigger === "manual") setAiError(payload.error);
          return;
        }
        setAiError(payload.error);
        setAiStatus("error");
        return;
      }
      setAiResult({ text: payload.text, truncated: payload.truncated, model: payload.model, trigger });
      setAiStatus("done");
    } catch {
      if (seq !== requestSeq.current) return;
      setAiError(UNREACHABLE_ERROR);
      setAiStatus("error");
    }
  }

  /** The "Convert with Gemini" button. */
  async function transcribeWithAi() {
    if (!file) return;
    await transcribe(file, "manual", ++requestSeq.current);
  }

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
    const seq = ++requestSeq.current;
    setStatus("uploading");
    setError(null);
    setResult(null);
    clearAi();

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
      if (seq !== requestSeq.current) return;
      if (!payload.ok) {
        setError(payload.error);
        setStatus("error");
        // A scan with no text layer, or text no table recognises: the engine
        // has nothing to offer, so the AI result becomes the only result.
        if (autoAi && isAiRecoverableFailure(payload.error)) await transcribe(file, "auto", seq);
        return;
      }
      setResult(payload);
      setStatus("done");
      if (autoAi && needsAiFallback(payload.quality)) await transcribe(file, "auto", seq);
    } catch {
      if (seq !== requestSeq.current) return;
      setError(UNREACHABLE_ERROR);
      setStatus("error");
    }
  }

  function selectFile(next: File | null) {
    requestSeq.current++;
    clearAi();
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
    aiStatus,
    aiResult,
    aiError,
    transcribeWithAi,
    autoAi,
    setAutoAi,
  };
}

export type UseDocumentConversionResult = ReturnType<typeof useDocumentConversion>;
