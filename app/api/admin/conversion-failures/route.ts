import { NextResponse, type NextRequest } from "next/server";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import {
  listFailurePatterns,
  summarizeFailurePatterns,
  type FailurePatternOrder,
} from "@/lib/firebase/conversionFailures";
import { FAILURE_CATEGORIES } from "@/features/converter/engine/classify";
import type { FailurePattern } from "@/lib/firebase/schemas";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 200;
const STATUSES = ["open", "resolved"] as const satisfies readonly FailurePattern["status"][];

/**
 * `?sort=frequent` is the top-N-by-occurrence view. Kept as a sort of the
 * same capped window rather than a separate endpoint, because the two
 * questions differ only in ordering and an admin switches between them while
 * looking at the same filtered set.
 */
const SORTS = {
  recent: "lastSeenAt",
  frequent: "occurrenceCount",
} as const satisfies Record<string, FailurePatternOrder>;

type SortKey = keyof typeof SORTS;

const fail = failResponder("api/admin/conversion-failures");

function readFilter<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Site-wide failure *patterns*, most-recently-active first by default and
 * most-frequent-first with `?sort=frequent` — this is the
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

  // An unrecognized sort falls back to the default rather than 400ing: this
  // is a view preference, and refusing the page over a typo in a bookmarked
  // URL would be a worse answer than showing it in the usual order.
  const sort: SortKey = readFilter(params.get("sort"), Object.keys(SORTS) as SortKey[]) ?? "recent";

  try {
    const patterns = await listFailurePatterns({
      limit: RECENT_LIMIT,
      encodingId: params.get("encodingId") || undefined,
      failureCategory: readFilter(params.get("failureCategory"), FAILURE_CATEGORIES),
      status: readFilter(params.get("status"), STATUSES),
      orderBy: SORTS[sort],
    });
    return NextResponse.json({
      ok: true,
      patterns,
      summary: summarizeFailurePatterns(patterns),
      // Echoed so the client can tell what it is looking at when it asked
      // for something the server did not recognize.
      sort,
    });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load conversion failure patterns."));
  }
}
