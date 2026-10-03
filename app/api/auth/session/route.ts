import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdminAuth, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { checkSharedRateLimit, rateLimitIdentity } from "@/lib/security/sharedRateLimit";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

// Every call here does an Admin SDK round trip (`createSessionCookie`
// verifies the ID token server-side) — cheap per call, but still worth
// bounding against a scripted hammering of this unauthenticated endpoint.
const RATE_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };

const bodySchema = z.object({ idToken: z.string().min(1) });

const fail = failResponder("api/auth/session");

/**
 * Exchanges a verified ID token for an httpOnly session cookie, used only so
 * `app/admin/layout.tsx` (a real server component, with no access to the
 * client SDK's bearer token) can check the admin claim before rendering.
 * This cookie is never accepted as authentication by any `/api/*` route —
 * those all still require a fresh `Authorization: Bearer <idToken>` header,
 * verified the same way as before Phase 7. Losing/rejecting this cookie only
 * ever affects whether the `/admin` page redirects, never any privileged
 * write.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Sessions aren't set up yet for this deployment."));
  }

  const caller = rateLimitIdentity(request, null);
  const rateLimit = await checkSharedRateLimit({
    key: `session:${caller.id}`,
    shared: caller.shared,
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
    return fail(AppErrors.validation('Expected { "idToken": string }.', { details: { field: "idToken" } }));
  }

  try {
    // Requires the ID token to have been issued within the last 5 minutes —
    // it always is here, since this is called immediately after sign-in or
    // an auth-state change, never replayed later.
    const sessionCookie = await getAdminAuth().createSessionCookie(parsed.data.idToken, {
      expiresIn: SESSION_MAX_AGE_MS,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_MS / 1000,
      path: "/",
    });
    return response;
  } catch (cause) {
    return fail(toAppError(cause, "Could not start a session."));
  }
}

export function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
