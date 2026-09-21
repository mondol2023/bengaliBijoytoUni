import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { FEEDBACK_LIMITS, listFeedback, updateFeedback } from "@/lib/firebase/feedback";
import { writeAuditLog } from "@/lib/firebase/audit";
import type { Feedback } from "@/lib/firebase/schemas";
import { failResponder, logAppError, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const RECENT_LIMIT = 100;
const STATUSES = ["new", "reviewed", "resolved"] as const satisfies readonly Feedback["status"][];

const fail = failResponder("api/admin/feedback");

/** Matches the rest of `/api/admin/*`: a lost audit row must not fail the action it describes. */
async function auditSafely(input: Parameters<typeof writeAuditLog>[0]) {
  try {
    await writeAuditLog(input);
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to write audit log.", debug: cause },
      { route: "api/admin/feedback" },
    );
  }
}

/** All submitted reviews/complaints, newest first, optionally filtered by triage status. */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const statusParam = request.nextUrl.searchParams.get("status");
  const status = statusParam && (STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as Feedback["status"])
    : undefined;

  try {
    const entries = await listFeedback({ limit: RECENT_LIMIT, status });
    return NextResponse.json({ ok: true, entries });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load feedback."));
  }
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(STATUSES).optional(),
  /** `null` clears an existing note; omit to leave it untouched. */
  adminNote: z.string().max(FEEDBACK_LIMITS.maxAdminNoteLength).nullable().optional(),
});

/** Triage one entry — change its status and/or attach an internal note. Audited. */
export async function PATCH(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(AppErrors.validation("Expected a JSON body."));
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      AppErrors.validation("Invalid feedback update.", {
        details: { field: parsed.error.issues[0]?.path.join(".") },
      }),
    );
  }

  try {
    const updated = await updateFeedback(parsed.data);
    if (!updated) return fail(AppErrors.validation("That feedback entry no longer exists."));

    await auditSafely({
      actorUid: auth.value.uid,
      action: "feedback.update",
      target: `feedback/${parsed.data.id}`,
      metadata: {
        status: parsed.data.status ?? null,
        noteChanged: parsed.data.adminNote !== undefined,
      },
    });

    return NextResponse.json({ ok: true, entry: updated });
  } catch (cause) {
    return fail(toAppError(cause, "Could not update this feedback entry."));
  }
}
