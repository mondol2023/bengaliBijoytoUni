"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { ErrorLogSummary } from "@/lib/firebase/errorLog";
import type { ErrorLog } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

type WithId<T> = T & { id: string };
type Response =
  | { ok: true; entries: WithId<ErrorLog>[]; summary: ErrorLogSummary }
  | { ok: false; error: SafeErrorResponse };

export interface ErrorFilters {
  kind: string;
  severity: string;
}

/** Radix `Select.Item` forbids an empty value, so "no filter" needs a real one. */
export const ANY_FILTER = "all";

const EMPTY_SUMMARY: ErrorLogSummary = { total: 0, byKind: {}, bySeverity: {}, topSamples: [] };

interface ErrorsState {
  entries: WithId<ErrorLog>[];
  summary: ErrorLogSummary;
  isLoading: boolean;
  error: string | null;
}

const LOADING_STATE: ErrorsState = {
  entries: [],
  summary: EMPTY_SUMMARY,
  isLoading: true,
  error: null,
};

function buildQuery(filters: ErrorFilters): string {
  const params = new URLSearchParams();
  if (filters.kind !== ANY_FILTER) params.set("kind", filters.kind);
  if (filters.severity !== ANY_FILTER) params.set("severity", filters.severity);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function fetchErrors(idToken: string | null, filters: ErrorFilters): Promise<Response | null> {
  if (!idToken) return null;
  const response = await fetch(`/api/admin/errors${buildQuery(filters)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return (await response.json()) as Response;
}

/**
 * Reads the persisted failure log for the admin page. Filtering happens
 * server-side (the route only ever returns a capped window, so filtering the
 * fetched page in the browser would silently hide older matches).
 */
export function useAdminErrors() {
  const { getIdToken } = useAuth();
  const [state, setState] = useState<ErrorsState>(LOADING_STATE);
  const [filters, setFilters] = useState<ErrorFilters>({ kind: ANY_FILTER, severity: ANY_FILTER });
  const [refreshToken, setRefreshToken] = useState(0);

  // A filter change or manual refresh resets to the loading state during
  // render rather than in an effect, so the list never shows stale rows
  // labelled with the new filter.
  const requestKey = `${filters.kind}|${filters.severity}|${refreshToken}`;
  const [appliedKey, setAppliedKey] = useState(requestKey);
  if (appliedKey !== requestKey) {
    setAppliedKey(requestKey);
    setState(LOADING_STATE);
  }

  useEffect(() => {
    let cancelled = false;
    void getIdToken()
      .then((idToken) => fetchErrors(idToken, filters))
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState({ ...LOADING_STATE, isLoading: false, error: "Could not verify your session." });
        } else if (!result.ok) {
          setState({ ...LOADING_STATE, isLoading: false, error: result.error.message });
        } else {
          setState({ entries: result.entries, summary: result.summary, isLoading: false, error: null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ ...LOADING_STATE, isLoading: false, error: "Could not reach the server." });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `requestKey` covers both filter fields
  }, [getIdToken, requestKey]);

  return {
    ...state,
    filters,
    setFilters,
    refresh: () => setRefreshToken((n) => n + 1),
  };
}
