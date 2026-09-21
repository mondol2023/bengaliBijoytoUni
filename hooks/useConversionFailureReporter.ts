"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { buildFailureOccurrence } from "@/lib/conversionFailures/occurrence";
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
 * Scoped to `unmapped_character` failures only: those are the ones with a
 * clear failed sequence and position a human can act on to fix a mapping
 * table. Whole-output warnings from `validateUnicodeOutput` (reorder
 * defects, NFC mismatches) describe a property of the entire result rather
 * than one legacy sequence, so they don't fit this pattern-keyed model
 * without inventing an identifier for them — they continue to surface only
 * through the existing `errorLogs` feed via `useIssueLog`.
 *
 * Reports at most once per distinct `(encodingId, engineVersion, sequence)`
 * pattern per mount (cost control, mirrors `reportIssue.ts`'s "only the
 * first occurrence" rule) and is strictly fire-and-forget — a failed report
 * never surfaces to the user, who is not looking at this pipeline at all.
 */
export function useConversionFailureReporter(
  context: ConversionFailureReportContext,
  output: ConversionOutput | null,
): void {
  const { user, getIdToken } = useAuth();
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const reportedPatterns = useRef(new Set<string>());

  useEffect(() => {
    if (!output || output.validation.unmappedDetails.length === 0) return;

    const unseen = output.validation.unmappedDetails.filter(
      (detail) => !reportedPatterns.current.has(patternKey(context.encodingId, output.engineVersion, detail.sequence)),
    );
    if (unseen.length === 0) return;
    for (const detail of unseen) {
      reportedPatterns.current.add(patternKey(context.encodingId, output.engineVersion, detail.sequence));
    }

    const failures = unseen.map((detail) => ({
      ...buildFailureOccurrence(
        {
          source: context.source,
          encodingId: context.encodingId,
          engineVersion: output.engineVersion,
          rulesHash: output.rulesHash,
          fileName: context.fileName,
          fileType: context.fileType,
        },
        output.sourceText,
        detail,
      ),
      sessionId,
    }));

    void (async () => {
      try {
        const idToken = user ? await getIdToken() : null;
        await fetch("/api/conversion-failures", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ failures }),
          keepalive: true,
        });
      } catch {
        // Intentionally silent — see the module doc.
      }
    })();
    // `context` is a fresh object literal each render, so its fields are
    // listed individually rather than depending on the object identity.
  }, [
    output,
    context.source,
    context.encodingId,
    context.fileName,
    context.fileType,
    sessionId,
    user,
    getIdToken,
  ]);
}
