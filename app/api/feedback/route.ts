import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { FEEDBACK_LIMITS, writeFeedback } from "@/lib/firebase/feedback";
import { checkRateLimit, getRequestIp } from "@/lib/security/rateLimit";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

// Deliberately tight: a human filling in a review form does it once, not
// twelve times a minute, and this route is reachable anonymously.
const RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

const fail = failResponder("api/feedback");

const bodySchema = z.object({
  category: z.enum([
    "wrong_conversion",
    "missing_character",
    "file_problem",
    "bug",
    "feature_request",
    "praise",
    "other",
  ]),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  message: z.string().trim().min(1).max(FEEDBACK_LIMITS.maxMessageLength),
  /** Self-reported contact for anonymous submissions; ignored when signed in. */
  email: z.string().email().max(254).nullable().optional(),
  page: z.string().max(128).nullable().optional(),
  encodingId: z.string().max(64).nullable().optional(),
  sampleInput: z.string().max(FEEDBACK_LIMITS.maxSampleLength).nullable().optional(),
  sampleOutput: z.string().max(FEEDBACK_LIMITS.maxSampleLength).nullable().optional(),
});

/**
 * Accepts a review/complaint from the form under each workspace. Open to
 * anonymous visitors on purpose — see `feedbackSchema`. A signed-in
 * submission's email comes from the verified token, so the stored contact is
 * trustworthy exactly when the submission is attributed.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Feedback isn't set up yet for this deployment."));
  }

  const user = await getServerUser(request);
  const rateLimit = checkRateLimit({
    key: `feedback:${user ? `uid:${user.uid}` : `ip:${getRequestIp(request)}`}`,
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
    const issue = parsed.error.issues[0];
    return fail(
      AppErrors.validation(
        issue?.path[0] === "message" ? "Please write a short description first." : "Invalid feedback submission.",
        { details: { field: issue?.path.join(".") } },
      ),
    );
  }

  try {
    const id = await writeFeedback({
      userId: user?.uid ?? null,
      email: user?.email ?? parsed.data.email ?? null,
      category: parsed.data.category,
      rating: parsed.data.rating ?? null,
      message: parsed.data.message,
      page: parsed.data.page ?? null,
      encodingId: parsed.data.encodingId ?? null,
      sampleInput: parsed.data.sampleInput ?? null,
      sampleOutput: parsed.data.sampleOutput ?? null,
    });
    return NextResponse.json({ ok: true, id });
  } catch (cause) {
    return fail(toAppError(cause, "Could not send your feedback — please try again."));
  }
}
