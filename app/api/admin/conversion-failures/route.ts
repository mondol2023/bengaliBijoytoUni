import { NextResponse, type NextRequest } from "next/server";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { listFailurePatterns, summarizeFailurePatterns } from "@/lib/firebase/conversionFailures";
import { FAILURE_CATEGORIES } from "@/features/converter/engine/classify";
import type { FailurePattern } from "@/lib/firebase/schemas";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 200;
const STATUSES = ["open", "resolved"] as const satisfies readonly FailurePattern["status"][];

const fail = failResponder("api/admin/conversion-failures");

function readFilter<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Site-wide failure *patterns*, most-recently-active first — this is the
 * aggregate dataset, not the raw per-occurrence one (which carries full
 * document text and is only ever read via
 * `/api/admin/conversion-failures/[patternId]`, one pattern at a time). The
 * summary is derived from the same capped window that is returned, matching
 * `/api/admin/errors`'s reasoning.
 */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const params = request.nextUrl.searchParams;

  try {
    const patterns = await listFailurePatterns({
      limit: RECENT_LIMIT,
      encodingId: params.get("encodingId") || undefined,
      failureCategory: readFilter(params.get("failureCategory"), FAILURE_CATEGORIES),
      status: readFilter(params.get("status"), STATUSES),
    });
    return NextResponse.json({ ok: true, patterns, summary: summarizeFailurePatterns(patterns) });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load conversion failure patterns."));
  }
}
