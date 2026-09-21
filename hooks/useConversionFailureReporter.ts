"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { buildFailureOccurrence, buildSignalOccurrence } from "@/lib/conversionFailures/occurrence";
import { createReportBuffer, type BufferedReport } from "@/lib/conversionFailures/reportBuffer";
import type { ConversionOutput } from "@/features/converter/engine/pipeline";

export interface ConversionFailureReportContext {
  source: "text" | "file" | "comparison" | "api";
  encodingId: string | null;
  fileName?: string | null;
  fileType?: string | null;
}

function patternKey(encodingId: string | null, engineVersion: string, sequence: string): string {
  return `${encodingId ?? ""}|${engineVersion}|${sequence}`;
}

/**
 * How long a delta may sit unsent. Long enough that a burst of debounced
 * conversions collapses into one request, short enough that a user who
 * closes the tab a few seconds after pasting is still counted.
 */
const FLUSH_DELAY_MS = 5_000;

/**
 * Posts occurrences to `/api/conversion-failures` for the conversion-failure
 * intelligence pipeline (see `docs/conversion-failure-pipeline.md`) —
 * separate from `useIssueLog`, which feeds the lightweight, real-time
 * `errorLogs` feed and stays untouched.
 *
 * Each report carries the failed sequence plus a bounded context window and
 * nothing more; `buildFailureOccurrence` owns that bound and the server
 * discards anything wider. The window is sliced from `output.sourceText`
 * rather than the raw input, because source hygiene can shift the offsets
 * the validation reports (see `ConversionOutput.sourceText`).
 *
 * Scoped to the two failures that have a clear sequence and position a
 * human can act on: `unmapped_character` (no rule matched) and
 * `ambiguous_typography` (a byte that is both Latin punctuation and a real
 * conjunct, flagged but deliberately not changed — see `normalizeSource`).
 * Whole-output warnings from `validateUnicodeOutput` (reorder defects, NFC
 * mismatches) describe a property of the entire result rather than one
 * legacy sequence, so they don't fit this pattern-keyed model without
 * inventing an identifier for them — they continue to surface only through
 * the existing `errorLogs` feed via `useIssueLog`.
 *
 * ## Batching
 *
 * Occurrences accumulate in a `ReportBuffer` and are sent as count deltas:
 * one request saying a pattern occurred forty-seven more times, rather than
 * one request per occurrence — or, as this hook used to behave, one report
 * per pattern per mount regardless of how many times it actually occurred.
 * That old rule made `occurrenceCount` a count of sessions wearing the name
 * of a count of occurrences; see `reportBuffer.ts` for what replaced it and
 * why the replacement is monotone.
 *
 * Flushes on a short timer, when the buffer fills, when the page is hidden,
 * and on unmount — the last three matter because a user who pastes a
 * document and immediately closes the tab is exactly the case worth
 * counting. Strictly fire-and-forget throughout: a failed report never
 * surfaces to the user, who is not looking at this pipeline at all.
 */
export function useConversionFailureReporter(
  context: ConversionFailureReportContext,
  output: ConversionOutput | null,
): void {
  const { user, getIdToken } = useAuth();
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  // Read inside the sender rather than captured in the buffer's closure, so
  // a token that arrives after the buffer was created is still used. Updated
  // in an effect, never during render.
  const authRef = useRef({ user, getIdToken });
  useEffect(() => {
    authRef.current = { user, getIdToken };
  }, [user, getIdToken]);

  const send = useCallback(
    async (items: BufferedReport[]) => {
      const failures = items.map((item) => ({
        ...item.occurrence,
        occurrenceCount: item.occurrenceCount,
        sessionId,
      }));
      try {
        const { user: currentUser, getIdToken: currentGetIdToken } = authRef.current;
        const idToken = currentUser ? await currentGetIdToken() : null;
        await fetch("/api/conversion-failures", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ failures }),
          // Survives the navigation that a pagehide flush is racing.
          keepalive: true,
        });
      } catch {
        // Intentionally silent — see the module doc.
      }
    },
    [sessionId],
  );

  // One buffer for the life of the hook, created on first use from inside an
  // effect or a handler — never during render, where reading a ref is both
  // lint-flagged and genuinely wrong under concurrent rendering. Its identity
  // must be stable: recreating it would lose the high-water marks and count
  // occurrences the user has already been credited with a second time.
  const bufferRef = useRef<ReturnType<typeof createReportBuffer> | null>(null);
  const getBuffer = useCallback(() => {
    bufferRef.current ??= createReportBuffer({ flush: send });
    return bufferRef.current;
  }, [send]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushNow = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void getBuffer().flushNow();
  }, [getBuffer]);

  // One set of listeners for the life of the hook. `pagehide` rather than
  // `unload`, which is ignored by browsers that keep pages in the back/
  // forward cache; `visibilitychange` catches a tab switched away from and
  // never returned to, which `pagehide` on its own can miss.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onHidden);
      flushNow();
    };
  }, [flushNow]);

  useEffect(() => {
    if (!output) return;
    const { unmappedDetails, sourceSignals } = output.validation;
    if (unmappedDetails.length === 0 && sourceSignals.length === 0) return;

    const meta = {
      source: context.source,
      encodingId: context.encodingId,
      engineVersion: output.engineVersion,
      rulesHash: output.rulesHash,
      fileName: context.fileName,
      fileType: context.fileType,
    };

    // The key spans both kinds, so an ambiguous byte and an unmapped byte
    // with the same sequence stay separate patterns.
    const keyFor = (kind: string, sequence: string) =>
      patternKey(context.encodingId, output.engineVersion, `${kind}:${sequence}`);

    const buffer = getBuffer();
    let buffered = 0;
    for (const detail of unmappedDetails) {
      buffered += buffer.record(
        keyFor("unmapped", detail.sequence),
        buildFailureOccurrence(meta, output.sourceText, detail),
        detail.count,
      );
    }
    for (const signal of sourceSignals) {
      buffered += buffer.record(
        keyFor("ambiguous", signal.sequence),
        buildSignalOccurrence(meta, output.sourceText, signal),
        signal.count,
      );
    }

    if (buffered === 0) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void buffer.flushNow();
    }, FLUSH_DELAY_MS);
    // `context` is a fresh object literal each render, so its fields are
    // listed individually rather than depending on the object identity.
  }, [
    output,
    context.source,
    context.encodingId,
    context.fileName,
    context.fileType,
    getBuffer,
  ]);
}
