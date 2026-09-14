"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { AdminUserRow } from "@/app/api/admin/users/route";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { TierId } from "@/types/domain";

type ListResponse = { ok: true; users: AdminUserRow[]; nextPageToken: string | null } | { ok: false; error: SafeErrorResponse };
type PatchResponse = { ok: true } | { ok: false; error: SafeErrorResponse };

interface UsersState {
  users: AdminUserRow[];
  nextPageToken: string | null;
  isLoading: boolean;
  error: string | null;
}

const LOADING_STATE: UsersState = { users: [], nextPageToken: null, isLoading: true, error: null };

async function listUsers(idToken: string | null, params: { email?: string; pageToken?: string }): Promise<ListResponse | null> {
  if (!idToken) return null;
  const query = new URLSearchParams();
  if (params.email) query.set("email", params.email);
  if (params.pageToken) query.set("pageToken", params.pageToken);
  const response = await fetch(`/api/admin/users?${query.toString()}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return (await response.json()) as ListResponse;
}

export interface UserPatch {
  tier?: TierId;
  disabled?: boolean;
  usageOverrideMaxChars?: number | null;
}

export function useAdminUsers() {
  const { getIdToken } = useAuth();
  const [state, setState] = useState<UsersState>(LOADING_STATE);
  const [query, setQuery] = useState<{ email?: string; refreshToken: number }>({ refreshToken: 0 });

  const [appliedQuery, setAppliedQuery] = useState(query);
  if (appliedQuery !== query) {
    setAppliedQuery(query);
    setState(LOADING_STATE);
  }

  useEffect(() => {
    let cancelled = false;
    void getIdToken()
      .then((idToken) => listUsers(idToken, { email: query.email }))
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState({ users: [], nextPageToken: null, isLoading: false, error: "Could not verify your session." });
        } else if (!result.ok) {
          setState({ users: [], nextPageToken: null, isLoading: false, error: result.error.message });
        } else {
          setState({ users: result.users, nextPageToken: result.nextPageToken, isLoading: false, error: null });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ users: [], nextPageToken: null, isLoading: false, error: "Could not reach the server." });
      });
    return () => {
      cancelled = true;
    };
  }, [getIdToken, query]);

  async function loadMore(): Promise<void> {
    if (!state.nextPageToken) return;
    const idToken = await getIdToken();
    const result = await listUsers(idToken, { email: query.email, pageToken: state.nextPageToken });
    if (result?.ok) {
      setState((current) => ({ ...current, users: [...current.users, ...result.users], nextPageToken: result.nextPageToken }));
    }
  }

  function search(email: string): void {
    setQuery({ email: email.trim() || undefined, refreshToken: 0 });
  }

  function refresh(): void {
    setQuery((current) => ({ ...current, refreshToken: current.refreshToken + 1 }));
  }

  /** Applies a patch and, on success, merges it straight into local state — the row we already have is the source of truth for what we asked to change. */
  async function updateUser(uid: string, patch: UserPatch): Promise<SafeErrorResponse | null> {
    const idToken = await getIdToken();
    if (!idToken) return { code: "AUTHENTICATION_ERROR", message: "Sign in to continue." };
    try {
      const response = await fetch(`/api/admin/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as PatchResponse;
      if (!payload.ok) return payload.error;
      setState((current) => ({
        ...current,
        users: current.users.map((row) => (row.uid === uid ? { ...row, ...patch } : row)),
      }));
      return null;
    } catch {
      return { code: "UNKNOWN_ERROR", message: "Could not reach the server — check your connection and try again." };
    }
  }

  return { ...state, search, loadMore, refresh, updateUser };
}
