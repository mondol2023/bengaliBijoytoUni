import { NextResponse, type NextRequest } from "next/server";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { listErrorLogs, summarizeErrorLogs } from "@/lib/firebase/errorLog";
import type { ErrorLog } from "@/lib/firebase/schemas";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 200;

const KINDS = [
  "unmapped_character",
  "conversion_failed",
  "file_extraction_failed",
  "validation_warning",
  "limit_exceeded",
  "rate_limited",
  "unknown",
] as const satisfies readonly ErrorLog["kind"][];

const SEVERITIES = ["error", "warning"] as const satisfies readonly ErrorLog["severity"][];

const fail = failResponder("api/admin/errors");

function readFilter<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Site-wide failure log, newest first, optionally filtered by kind or
 * severity. The summary is derived from the same capped window that is
 * returned, so what the header counts and what the list shows can never
 * disagree — see `summarizeErrorLogs`.
 */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const params = request.nextUrl.searchParams;

  try {
    const entries = await listErrorLogs({
      limit: RECENT_LIMIT,
      kind: readFilter(params.get("kind"), KINDS),
      severity: readFilter(params.get("severity"), SEVERITIES),
    });
    return NextResponse.json({ ok: true, entries, summary: summarizeErrorLogs(entries) });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load the error log."));
  }
}
