"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { recordIssue } from "@/lib/log/reportIssue";
import { eventKey, type ConversionLogInput, type LogEventKind, type LogSource } from "@/lib/log/conversionLog";
import { formatUnmappedDetails, type ValidationResult } from "@/features/converter/engine/pipeline";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { AppError, AppErrorCode } from "@/lib/errors/types";

/** Anything carrying a `code` + `message` — the engine's `AppError` and the API's safe response both do. */
type ErrorLike = Pick<AppError, "code" | "message"> | SafeErrorResponse;

const KIND_BY_CODE: Partial<Record<AppErrorCode, LogEventKind>> = {
  FILE_PROCESSING_ERROR: "file_extraction_failed",
  CONVERSION_ERROR: "conversion_failed",
  VALIDATION_ERROR: "conversion_failed",
  LIMIT_EXCEEDED_ERROR: "limit_exceeded",
  RATE_LIMIT_ERROR: "rate_limited",
};

/** Mirrors `ERROR_LOG_LIMITS.maxSamples` — kept small here too so the visible log stays readable. */
const MAX_SAMPLES = 20;

/** Details spelled out in a log row's message; `ERROR_LOG_LIMITS.maxMessageLength` clamps the rest. */
const MAX_LOGGED_DETAILS = 4;

export interface IssueContext {
  source: LogSource;
  encodingId?: string | null;
  fileName?: string | null;
  fileType?: string | null;
}

/**
 * The log row's headline plus, where the engine could work them out, the
 * windows of converted text around each unmapped byte. `samples` stays the
 * bare sequence list because `summarizeLog` builds the "letters that failed
 * to convert" chips from it — the context belongs in the message instead,
 * so a persisted row still says where the problem was.
 */
function unmappedMessage(validation: ValidationResult): string {
  const headline = `${validation.unmappedSequences.length} legacy character sequence(s) had no mapping rule and were passed through unchanged.`;
  const details = formatUnmappedDetails(validation.unmappedDetails, MAX_LOGGED_DETAILS);
  return details ? `${headline}\n${details}` : headline;
}

/**
 * Turns one conversion attempt's outcome into the log rows it deserves.
 * Exported for testing — it is pure, unlike the hook below it.
 *
 * When a conversion has unmapped characters, only the character-level row is
 * produced: `validateTokens` also pushes a prose warning describing the same
 * unmapped sequences, and logging both would show every failed letter twice.
 */
export function deriveIssues(
  context: IssueContext,
  outcome: { error?: ErrorLike | null; validation?: ValidationResult | null },
): ConversionLogInput[] {
  const base = {
    source: context.source,
    encodingId: context.encodingId ?? null,
    fileName: context.fileName ?? null,
    fileType: context.fileType ?? null,
  };
  const issues: ConversionLogInput[] = [];

  if (outcome.error) {
    issues.push({
      ...base,
      kind: KIND_BY_CODE[outcome.error.code as AppErrorCode] ?? "unknown",
      severity: "error",
      code: outcome.error.code,
      message: outcome.error.message,
      samples: [],
    });
  }

  const validation = outcome.validation;
  if (validation && !validation.valid) {
    if (validation.unmappedSequences.length > 0) {
      issues.push({
        ...base,
        kind: "unmapped_character",
        severity: "warning",
        code: "UNMAPPED_CHARACTER",
        message: unmappedMessage(validation),
        samples: validation.unmappedSequences.slice(0, MAX_SAMPLES),
      });
    } else {
      for (const warning of validation.warnings) {
        issues.push({
          ...base,
          kind: "validation_warning",
          severity: "warning",
          code: "VALIDATION_WARNING",
          message: warning,
          samples: [],
        });
      }
    }
  }

  return issues;
}

/**
 * Records an issue in the visible session log and persists it, attributed to
 * the signed-in user when there is one. Stable identity, so callers can use
 * it inside an effect without re-running on every render.
 */
export function useIssueReporter() {
  const { user, getIdToken } = useAuth();
  return useCallback(
    (input: ConversionLogInput) => {
      recordIssue(input, { getIdToken: user ? getIdToken : undefined });
    },
    [user, getIdToken],
  );
}

/**
 * Watches one workspace's conversion outcome and logs whatever went wrong.
 * The effect keys on the derived issues' identity keys rather than on the
 * result objects themselves, so a re-render that produces the same failure
 * doesn't record a duplicate occurrence.
 */
export function useIssueLog(
  context: IssueContext,
  outcome: { error?: ErrorLike | null; validation?: ValidationResult | null },
): void {
  const report = useIssueReporter();

  const issues = useMemo(
    () => deriveIssues(context, outcome),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content below, not object identity
    [
      context.source,
      context.encodingId,
      context.fileName,
      context.fileType,
      outcome.error,
      outcome.validation,
    ],
  );
  const signature = issues.map(eventKey).join("\u0002");

  useEffect(() => {
    for (const issue of issues) report(issue);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` is the content-derived key for `issues`
  }, [signature, report]);
}
