"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Feedback } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

type WithId<T> = T & { id: string };
type ListResponse = { ok: true; entries: WithId<Feedback>[] } | { ok: false; error: SafeErrorResponse };
type PatchResponse = { ok: true; entry: WithId<Feedback> } | { ok: false; error: SafeErrorResponse };

/** Radix `Select.Item` forbids an empty value, so "no filter" needs a real one. */
export const ANY_STATUS = "all";

interface FeedbackState {
  entries: WithId<Feedback>[];
  isLoading: boolean;
  error: string | null;
}

const LOADING_STATE: FeedbackState = { entries: [], isLoading: true, error: null };

async function fetchFeedback(idToken: string | null, status: string): Promise<ListResponse | null> {
  if (!idToken) return null;
  const query = status === ANY_STATUS ? "" : `?status=${encodeURIComponent(status)}`;
  const response = await fetch(`/api/admin/feedback${query}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return (await response.json()) as ListResponse;
}

export interface FeedbackUpdate {
  id: string;
  status?: Feedback["status"];
  adminNote?: string | null;
}

export function useAdminFeedback() {
  const { getIdToken } = useAuth();
  const [state, setState] = useState<FeedbackState>(LOADING_STATE);
  const [status, setStatus] = useState<string>(ANY_STATUS);
  const [refreshToken, setRefreshToken] = useState(0);

  const requestKey = `${status}|${refreshToken}`;
  const [appliedKey, setAppliedKey] = useState(requestKey);
  if (appliedKey !== requestKey) {
    setAppliedKey(requestKey);
    setState(LOADING_STATE);
  }

  useEffect(() => {
    let cancelled = false;
    void getIdToken()
      .then((idToken) => fetchFeedback(idToken, status))
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState({ entries: [], isLoading: false, error: "Could not verify your session." });
        } else if (!result.ok) {
          setState({ entries: [], isLoading: false, error: result.error.message });
        } else {
          setState({ entries: result.entries, isLoading: false, error: null });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ entries: [], isLoading: false, error: "Could not reach the server." });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `requestKey` carries `status` and the refresh counter
  }, [getIdToken, requestKey]);

  /**
   * Triages one entry. The server's updated row replaces the local one rather
   * than the list being refetched — a status change under an active status
   * filter would otherwise make the row vanish mid-edit, before the admin has
   * finished writing their note.
   */
  const update = useCallback(
    async (input: FeedbackUpdate): Promise<SafeErrorResponse | null> => {
      const idToken = await getIdToken();
      if (!idToken) return { code: "AUTHENTICATION_ERROR", message: "Could not verify your session." };
      try {
        const response = await fetch("/api/admin/feedback", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify(input),
        });
        const payload = (await response.json()) as PatchResponse;
        if (!payload.ok) return payload.error;

        setState((current) => ({
          ...current,
          entries: current.entries.map((entry) => (entry.id === payload.entry.id ? payload.entry : entry)),
        }));
        return null;
      } catch {
        return { code: "UNKNOWN_ERROR", message: "Could not reach the server." };
      }
    },
    [getIdToken],
  );

  return {
    ...state,
    status,
    setStatus,
    update,
    refresh: () => setRefreshToken((n) => n + 1),
  };
}
