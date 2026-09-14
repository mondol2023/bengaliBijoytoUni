"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { AdminStatsDaily, AdminStatsTotals } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

type Response = { ok: true; totals: AdminStatsTotals; daily: AdminStatsDaily[] } | { ok: false; error: SafeErrorResponse };

interface OverviewState {
  totals: AdminStatsTotals | null;
  daily: AdminStatsDaily[];
  isLoading: boolean;
  error: string | null;
}

const LOADING_STATE: OverviewState = { totals: null, daily: [], isLoading: true, error: null };

/**
 * Pure fetch — no `setState` anywhere in this function, so the `.then`
 * chain at each call site below is the only place state changes (see
 * `useAccountHistory.ts` for why this shape is required to satisfy
 * `react-hooks/set-state-in-effect`).
 */
async function fetchOverview(idToken: string | null): Promise<Response | null> {
  if (!idToken) return null;
  const response = await fetch("/api/admin/overview", { headers: { Authorization: `Bearer ${idToken}` } });
  return (await response.json()) as Response;
}

export function useAdminOverview() {
  const { getIdToken } = useAuth();
  const [state, setState] = useState<OverviewState>(LOADING_STATE);
  const [refreshToken, setRefreshToken] = useState(0);

  // Resets to the loading state during render whenever a manual refresh is
  // requested — React's "adjusting state when a prop changes" pattern,
  // rather than a synchronous setState inside the effect below.
  const [appliedRefreshToken, setAppliedRefreshToken] = useState(refreshToken);
  if (appliedRefreshToken !== refreshToken) {
    setAppliedRefreshToken(refreshToken);
    setState(LOADING_STATE);
  }

  useEffect(() => {
    let cancelled = false;
    void getIdToken()
      .then(fetchOverview)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState({ totals: null, daily: [], isLoading: false, error: "Could not verify your session." });
        } else if (!result.ok) {
          setState({ totals: null, daily: [], isLoading: false, error: result.error.message });
        } else {
          setState({ totals: result.totals, daily: result.daily, isLoading: false, error: null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ totals: null, daily: [], isLoading: false, error: "Could not reach the server." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getIdToken, refreshToken]);

  return { ...state, refresh: () => setRefreshToken((n) => n + 1) };
}
