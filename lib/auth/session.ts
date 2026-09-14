/**
 * Server-only request authentication. Every privileged route handler calls
 * `getServerUser`/`requireServerUser`/`requireAdminUser` instead of reading
 * any client-supplied uid/role field — identity and role both come only
 * from a verified Firebase ID token, never from the request body.
 */
import { cookies } from "next/headers";
import { getAdminAuth, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { AppErrors } from "@/lib/errors/types";
import type { Result } from "@/lib/errors/types";
import type { UserRole } from "@/types/domain";

/** Shared with `app/api/auth/session/route.ts`, the only place that sets/clears this cookie. */
export const SESSION_COOKIE_NAME = "session";

export interface ServerUser {
  uid: string;
  email: string | null;
  /** From the Firebase Auth custom claim `admin: true` — never from a Firestore field. */
  role: UserRole;
}

/** Returns the caller's verified identity, or null if unauthenticated (not an error — most routes allow anonymous use). */
export async function getServerUser(request: Request): Promise<ServerUser | null> {
  if (!isFirebaseAdminConfigured) return null;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const idToken = header.slice("Bearer ".length).trim();
  if (!idToken) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      role: decoded.admin === true ? "admin" : "user",
    };
  } catch {
    return null;
  }
}

export async function requireServerUser(request: Request): Promise<Result<ServerUser>> {
  const user = await getServerUser(request);
  if (!user) return { ok: false, error: AppErrors.authentication("Sign in to continue.") };
  return { ok: true, value: user };
}

export async function requireAdminUser(request: Request): Promise<Result<ServerUser>> {
  const result = await requireServerUser(request);
  if (!result.ok) return result;
  if (result.value.role !== "admin") {
    return { ok: false, error: AppErrors.authorization("Admin access required.") };
  }
  return result;
}

/**
 * Server-component counterpart to `getServerUser` — reads the httpOnly
 * session cookie (`app/api/auth/session/route.ts`) instead of a bearer
 * token, since a page render has no access to one. Used only by
 * `app/admin/layout.tsx` to gate the admin UI before it renders; every
 * actual mutation still goes through a `/api/admin/*` route that calls
 * `requireAdminUser` above against a fresh bearer token.
 */
export async function getServerSessionUser(): Promise<ServerUser | null> {
  if (!isFirebaseAdminConfigured) return null;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      role: decoded.admin === true ? "admin" : "user",
    };
  } catch {
    return null;
  }
}
