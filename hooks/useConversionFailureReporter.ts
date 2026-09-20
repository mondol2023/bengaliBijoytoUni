"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { ConversionOutput, UnmappedDetail } from "@/features/converter/engine/pipeline";

/**
 * Characters of the original input shown either side of a failed sequence in
 * `contextBefore`/`contextAfter`. Independent of `validate.ts`'s
 * `CONTEXT_TOKENS` (which windows *tokens* of converted output for the
 * in-app log) — this windows *characters* of the original legacy text, since
 * that's what a human fixing the mapping table needs to see.
 */
const CONTEXT_WINDOW_CHARS = 80;

export interface ConversionFailureReportContext {
  source: "text" | "file" | "comparison" | "api";
  encodingId: string | null;
  /** The complete original conversion input — sent to `/api/conversion-failures`, never to an AI provider. */
  fullText: string;
  fileName?: string | null;
  fileType?: string | null;
}

function patternKey(encodingId: string | null, engineVersion: string, sequence: string): string {
  return `${encodingId ?? ""}|${engineVersion}|${sequence}`;
}

function buildOccurrence(
  context: ConversionFailureReportContext,
  output: ConversionOutput,
  detail: UnmappedDetail,
) {
  const position = detail.positions[0] ?? null;
  const contextBefore =
    position === null ? "" : context.fullText.slice(Math.max(0, position - CONTEXT_WINDOW_CHARS), position);
  const contextAfter =
    position === null
      ? ""
      : context.fullText.slice(
          position + detail.sequence.length,
          position + detail.sequence.length + CONTEXT_WINDOW_CHARS,
        );

  return {
    source: context.source,
    encodingId: context.encodingId,
    engineVersion: output.engineVersion,
    rulesHash: output.rulesHash,
    failureCategory: "unmapped_character" as const,
    failedSequence: detail.sequence,
    position,
    contextBefore,
    contextAfter,
    fullText: context.fullText,
    engineOutput: output.unicodeText,
    errorCode: "UNMAPPED_CHARACTER",
    errorReason: `"${detail.sequence}" occurred ${detail.count} time(s) with no mapping rule in this encoding.`,
    severity: "warning" as const,
    fileName: context.fileName ?? null,
    fileType: context.fileType ?? null,
  };
}

/**
 * Posts detailed, full-context occurrences to `/api/conversion-failures` for
 * the conversion-failure intelligence pipeline (see
 * `docs/conversion-failure-pipeline.md`) — separate from `useIssueLog`, which
 * feeds the lightweight, real-time `errorLogs` feed and stays untouched.
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

    const failures = unseen.map((detail) => ({ ...buildOccurrence(context, output, detail), sessionId }));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportedPatterns/sessionId are refs/stable; context fields listed individually below
  }, [
    output,
    context.source,
    context.encodingId,
    context.fullText,
    context.fileName,
    context.fileType,
    sessionId,
    user,
    getIdToken,
  ]);
}
