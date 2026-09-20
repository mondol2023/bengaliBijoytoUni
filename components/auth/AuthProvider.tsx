"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { getFirebaseAuth, getGoogleProvider, isFirebaseConfigured } from "@/lib/firebase/client";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { TierId, UserRole } from "@/types/domain";

export interface AccountProfile {
  tier: TierId;
  role: UserRole;
}

interface AuthContextValue {
  /** Whether a real Firebase project is wired up (see `docs/firebase-setup.md`). */
  isConfigured: boolean;
  /** True until the initial auth-state check resolves. */
  isLoading: boolean;
  user: User | null;
  /** The signed-in user's `users/{uid}` profile, once fetched. Null while signed out or still loading. */
  profile: AccountProfile | null;
  isProfileLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<SafeErrorResponse | null>;
  signUpWithEmail: (email: string, password: string) => Promise<SafeErrorResponse | null>;
  signInWithGoogle: () => Promise<SafeErrorResponse | null>;
  signOutUser: () => Promise<void>;
  /** Persists the signed-in user's account tier server-side (`/api/users/me`). */
  setAccountTier: (tier: TierId) => Promise<SafeErrorResponse | null>;
  /** Bearer token for authenticated fetches to this app's own API routes; null if signed out. */
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_CONFIGURED_ERROR: SafeErrorResponse = {
  code: "UNKNOWN_ERROR",
  message: "Sign-in isn't set up yet for this deployment — see docs/firebase-setup.md.",
};

const UNREACHABLE_ERROR: SafeErrorResponse = {
  code: "UNKNOWN_ERROR",
  message: "Could not reach the server — check your connection and try again.",
};

/**
 * Translates Firebase Auth's `auth/*` error codes into safe, specific copy
 * instead of a raw SDK message. Exported (pure, no component/hook state)
 * so the mapping table and its unknown-code fallback can be unit-tested
 * directly — see `__tests__/mapFirebaseAuthError.test.ts`.
 */
export function mapFirebaseAuthError(cause: unknown): SafeErrorResponse {
  const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
  const messages: Record<string, string> = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email — try signing in instead.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/network-request-failed": "Network error — check your connection and try again.",
    "auth/too-many-requests": "Too many attempts — wait a moment and try again.",
  };
  return { code: "AUTHENTICATION_ERROR", message: messages[code] ?? "Sign-in failed. Please try again." };
}

async function fetchProfile(idToken: string): Promise<AccountProfile | null> {
  try {
    const response = await fetch("/api/users/me", { headers: { Authorization: `Bearer ${idToken}` } });
    const payload = (await response.json()) as { ok: true; tier: TierId; role: UserRole } | { ok: false };
    return payload.ok ? { tier: payload.tier, role: payload.role } : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort sync of an httpOnly session cookie, used only so
 * `app/admin/layout.tsx` (a real server component) can verify the admin
 * claim before rendering — defense in depth alongside the Firestore rules
 * and the `requireAdminUser` check every `/api/admin/*` route already does.
 * This is not itself a security boundary: every privileged mutation still
 * requires a verified Bearer token, exactly as before. A failure here just
 * means the `/admin` page gate falls back to redirecting until the next
 * sign-in refreshes it — never a reason to fail sign-in/out.
 */
function syncSessionCookie(idToken: string): void {
  void fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  }).catch(() => undefined);
}

function clearSessionCookie(): void {
  void fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(isFirebaseConfigured);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  // Tracks which user the `profile`/`isProfileLoading` state above belongs
  // to, so a user change resets stale profile data and (re)starts the
  // loading flag during render — React's documented pattern for "adjusting
  // state when a prop changes" — instead of a synchronous setState call
  // inside an effect, which can trigger cascading renders.
  const [profileOwner, setProfileOwner] = useState<User | null>(null);
  if (profileOwner !== user) {
    setProfileOwner(user);
    setProfile(null);
    setIsProfileLoading(Boolean(user));
  }

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    // The SDK loads on demand (see `lib/firebase/client`), so subscribing is
    // async and cleanup has to cope with unmounting before it resolves.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const [{ onAuthStateChanged }, auth] = await Promise.all([
        import("firebase/auth"),
        getFirebaseAuth(),
      ]);
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        setIsLoading(false);
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      if (isFirebaseConfigured) clearSessionCookie();
      return;
    }
    let cancelled = false;
    void user
      .getIdToken()
      .then((idToken) => {
        syncSessionCookie(idToken);
        return fetchProfile(idToken);
      })
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .finally(() => {
        if (!cancelled) setIsProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const getIdToken = useCallback(async () => {
    if (!user) return null;
    return user.getIdToken();
  }, [user]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!isFirebaseConfigured) return NOT_CONFIGURED_ERROR;
    try {
      const [{ signInWithEmailAndPassword }, auth] = await Promise.all([
        import("firebase/auth"),
        getFirebaseAuth(),
      ]);
      await signInWithEmailAndPassword(auth, email, password);
      return null;
    } catch (cause) {
      return mapFirebaseAuthError(cause);
    }
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    if (!isFirebaseConfigured) return NOT_CONFIGURED_ERROR;
    try {
      const [{ createUserWithEmailAndPassword }, auth] = await Promise.all([
        import("firebase/auth"),
        getFirebaseAuth(),
      ]);
      await createUserWithEmailAndPassword(auth, email, password);
      return null;
    } catch (cause) {
      return mapFirebaseAuthError(cause);
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!isFirebaseConfigured) return NOT_CONFIGURED_ERROR;
    try {
      const [{ signInWithPopup }, auth, provider] = await Promise.all([
        import("firebase/auth"),
        getFirebaseAuth(),
        getGoogleProvider(),
      ]);
      await signInWithPopup(auth, provider);
      return null;
    } catch (cause) {
      return mapFirebaseAuthError(cause);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    if (!isFirebaseConfigured) return;
    const [{ signOut }, auth] = await Promise.all([
      import("firebase/auth"),
      getFirebaseAuth(),
    ]);
    await signOut(auth);
  }, []);

  const setAccountTier = useCallback(
    async (tier: TierId) => {
      const idToken = await getIdToken();
      if (!idToken) return NOT_CONFIGURED_ERROR;
      try {
        const response = await fetch("/api/users/me", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ tier }),
        });
        const payload = (await response.json()) as
          | { ok: true; tier: TierId; role: UserRole }
          | { ok: false; error: SafeErrorResponse };
        if (!payload.ok) return payload.error;
        setProfile({ tier: payload.tier, role: payload.role });
        return null;
      } catch {
        return UNREACHABLE_ERROR;
      }
    },
    [getIdToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: isFirebaseConfigured,
      isLoading,
      user,
      profile,
      isProfileLoading,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOutUser,
      setAccountTier,
      getIdToken,
    }),
    [isLoading, user, profile, isProfileLoading, signInWithEmail, signUpWithEmail, signInWithGoogle, signOutUser, setAccountTier, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider.");
  return context;
}
