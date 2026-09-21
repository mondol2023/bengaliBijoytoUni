import { NextResponse, type NextRequest } from "next/server";
import { requireAdminUser } from "@/lib/auth/session";
import { failResponder } from "@/lib/errors/handlers";
import { flushWriteMetrics, getWriteMetricsSnapshot } from "@/lib/firebase/writeMetrics";

export const runtime = "nodejs";

const fail = failResponder("api/admin/write-metrics");

/**
 * What this instance has written to Firestore, by day and collection.
 *
 * **One instance, not the deployment.** The counters live in process memory
 * and die with it, so on a multi-instance or serverless host this is a live
 * sanity check rather than a total. The deployment-wide number comes from
 * summing the `firestore_writes` lines these processes emit to stdout, which
 * carry the same day buckets plus an `instanceId` — see
 * `lib/firebase/writeMetrics.ts` for why the counters are not themselves
 * stored in Firestore.
 *
 * Admin-gated even though it contains no user data: it describes
 * infrastructure load, and an anonymous reader could use it to confirm
 * whether an attempt to flood the reporting endpoint was working.
 *
 * Reads nothing and writes nothing — deliberately safe to call while the
 * dev-environment question in `docs/dev-environment.md` is still open.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  // Push the pending window out first, so the drained log and this snapshot
  // cannot disagree about writes that happened seconds ago.
  flushWriteMetrics();

  const snapshot = getWriteMetricsSnapshot();
  return NextResponse.json({
    ok: true,
    scope: "this server instance only",
    ...snapshot,
  });
}
