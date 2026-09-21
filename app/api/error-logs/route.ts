import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerUser, requireServerUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { ERROR_LOG_LIMITS, listErrorLogs, writeErrorLog } from "@/lib/firebase/errorLog";
import { checkRateLimit, getRequestIp } from "@/lib/security/rateLimit";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 50;

// Text conversion runs entirely in the browser, so a busy session can
// legitimately produce a burst of distinct failures (one per encoding tried,
// one per file). The client already de-duplicates identical issues before
// reporting (see `lib/log/conversionLog.ts`), so this ceiling only has to
// stop a scripted flood, not normal use.
const RATE_LIMIT = { limit: 60, windowMs: 5 * 60 * 1000 };

const fail = failResponder("api/error-logs");

const bodySchema = z.object({
  source: z.enum(["text", "file", "comparison"]),
  kind: z.enum([
    "unmapped_character",
    "conversion_failed",
    "file_extraction_failed",
    "validation_warning",
    "limit_exceeded",
    "rate_limited",
    "unknown",
  ]),
  severity: z.enum(["error", "warning"]),
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(ERROR_LOG_LIMITS.maxMessageLength),
  encodingId: z.string().max(64).nullable().optional(),
  fileName: z.string().max(256).nullable().optional(),
  fileType: z.string().max(32).nullable().optional(),
  samples: z.array(z.string().max(ERROR_LOG_LIMITS.maxSampleLength)).max(ERROR_LOG_LIMITS.maxSamples).optional(),
  occurrences: z.number().int().positive().max(10_000).optional(),
});

/**
 * Records one failure reported by the browser. Deliberately open to
 * anonymous callers: the conversions most likely to fail are the ones a
 * first-time visitor pastes in before ever signing up, and a failure log
 * that only covers signed-in users would miss exactly the mappings worth
 * fixing. `userId` is taken from the verified token when there is one and is
 * null otherwise — never read from the request body.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    // Not an error the user needs to see — the local/dev deployment simply
    // has no backend to log to. The browser keeps its own session log either
    // way, so reporting degrades to "visible in-app, just not persisted".
    return NextResponse.json({ ok: true, persisted: false });
  }

  const user = await getServerUser(request);
  const rateLimit = checkRateLimit({
    key: `error-logs:${user ? `uid:${user.uid}` : `ip:${getRequestIp(request)}`}`,
    ...RATE_LIMIT,
  });
  if (!rateLimit.ok) return fail(rateLimit.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(AppErrors.validation("Expected a JSON body."));
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      AppErrors.validation("Invalid error report.", {
        details: { field: parsed.error.issues[0]?.path.join(".") },
      }),
    );
  }

  try {
    const id = await writeErrorLog({
      userId: user?.uid ?? null,
      source: parsed.data.source,
      kind: parsed.data.kind,
      severity: parsed.data.severity,
      code: parsed.data.code,
      message: parsed.data.message,
      encodingId: parsed.data.encodingId ?? null,
      fileName: parsed.data.fileName ?? null,
      fileType: parsed.data.fileType ?? null,
      samples: parsed.data.samples ?? [],
      occurrences: parsed.data.occurrences ?? 1,
      route: null,
    });
    return NextResponse.json({ ok: true, persisted: true, id });
  } catch (cause) {
    return fail(toAppError(cause, "Could not record this failure."));
  }
}

/** The caller's own recorded failures, newest first — never another user's. */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return NextResponse.json({ ok: true, entries: [] });
  }
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  try {
    const entries = await listErrorLogs({ limit: RECENT_LIMIT, userId: auth.value.uid });
    return NextResponse.json({ ok: true, entries });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load your error log."));
  }
}
