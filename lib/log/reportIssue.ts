/**
 * Bridges the in-session log (`conversionLog.ts`) to the persisted backend
 * log (`/api/error-logs`).
 *
 * Two rules keep this from becoming a firehose. First, only the *first*
 * occurrence of a distinct issue is posted — `appendEvent` tells us whether a
 * report merged into an existing row, and a merge means the backend already
 * has it. Second, reporting is strictly fire-and-forget: a failed report is
 * swallowed, because the user is already looking at the failure it describes
 * and a second error about the error would be noise.
 */
import { logIssue, type ConversionLogInput } from "./conversionLog";

export interface ReportOptions {
  /** Supplied by the caller so a signed-in report is attributed; null/omitted reports anonymously. */
  getIdToken?: () => Promise<string | null>;
}

async function postReport(input: ConversionLogInput, options: ReportOptions): Promise<void> {
  try {
    const idToken = options.getIdToken ? await options.getIdToken() : null;
    await fetch("/api/error-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        source: input.source,
        kind: input.kind,
        severity: input.severity,
        code: input.code,
        message: input.message,
        encodingId: input.encodingId ?? null,
        fileName: input.fileName ?? null,
        fileType: input.fileType ?? null,
        samples: input.samples ?? [],
      }),
      keepalive: true,
    });
  } catch {
    // Intentionally silent — see the module doc.
  }
}

/** Records an issue in the visible session log and, if it's new, persists it. */
export function recordIssue(input: ConversionLogInput, options: ReportOptions = {}): void {
  const { isNew } = logIssue(input);
  if (isNew) void postReport(input, options);
}
