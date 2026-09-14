"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { AuditLog } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

type WithId<T> = T & { id: string };
type Response = { ok: true; entries: WithId<AuditLog>[] } | { ok: false; error: SafeErrorResponse };

interface AuditState {
  entries: WithId<AuditLog>[];
  isLoading: boolean;
  error: string | null;
}

const LOADING_STATE: AuditState = { entries: [], isLoading: true, error: null };

async function fetchAudit(idToken: string | null): Promise<Response | null> {
  if (!idToken) return null;
  const response = await fetch("/api/admin/audit", { headers: { Authorization: `Bearer ${idToken}` } });
  return (await response.json()) as Response;
}

export function useAdminAudit() {
  const { getIdToken } = useAuth();
  const [state, setState] = useState<AuditState>(LOADING_STATE);
  const [refreshToken, setRefreshToken] = useState(0);

  const [appliedRefreshToken, setAppliedRefreshToken] = useState(refreshToken);
  if (appliedRefreshToken !== refreshToken) {
    setAppliedRefreshToken(refreshToken);
    setState(LOADING_STATE);
  }

  useEffect(() => {
    let cancelled = false;
    void getIdToken()
      .then(fetchAudit)
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
  }, [getIdToken, refreshToken]);

  return { ...state, refresh: () => setRefreshToken((n) => n + 1) };
}
