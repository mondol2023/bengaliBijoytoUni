"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { FailurePatternSummary } from "@/lib/firebase/conversionFailures";
import type { FailurePattern } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

type WithId<T> = T & { id: string };
type Response =
  | { ok: true; patterns: WithId<FailurePattern>[]; summary: FailurePatternSummary }
  | { ok: false; error: SafeErrorResponse };

export interface FailurePatternFilters {
  failureCategory: string;
  status: string;
  /** "recent" (default, most recently active) or "frequent" (top N by occurrence count). */
  sort: string;
}

export const DEFAULT_SORT = "recent";

/** Radix `Select.Item` forbids an empty value, so "no filter" needs a real one. */
export const ANY_FILTER = "all";

const EMPTY_SUMMARY: FailurePatternSummary = {
  totalPatterns: 0,
  totalOccurrences: 0,
  byCategory: {},
  openCount: 0,
  resolvedCount: 0,
};

interface FailurePatternsState {
  patterns: WithId<FailurePattern>[];
  summary: FailurePatternSummary;
  isLoading: boolean;
  error: string | null;
}

const LOADING_STATE: FailurePatternsState = {
  patterns: [],
  summary: EMPTY_SUMMARY,
  isLoading: true,
  error: null,
};

function buildQuery(filters: FailurePatternFilters): string {
  const params = new URLSearchParams();
  if (filters.failureCategory !== ANY_FILTER) params.set("failureCategory", filters.failureCategory);
  if (filters.status !== ANY_FILTER) params.set("status", filters.status);
  if (filters.sort !== DEFAULT_SORT) params.set("sort", filters.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function fetchPatterns(idToken: string | null, filters: FailurePatternFilters): Promise<Response | null> {
  if (!idToken) return null;
  const response = await fetch(`/api/admin/conversion-failures${buildQuery(filters)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return (await response.json()) as Response;
}

/**
 * Reads the failure-pattern list for the admin page. Filtering happens
 * server-side, like `useAdminErrors` — the route only ever returns a capped
 * window, so filtering the fetched page in the browser would silently hide
 * older matches.
 */
export function useAdminConversionFailures() {
  const { getIdToken } = useAuth();
  const [state, setState] = useState<FailurePatternsState>(LOADING_STATE);
  const [filters, setFilters] = useState<FailurePatternFilters>({
    failureCategory: ANY_FILTER,
    status: ANY_FILTER,
    sort: DEFAULT_SORT,
  });
  const [refreshToken, setRefreshToken] = useState(0);

  const requestKey = `${filters.failureCategory}|${filters.status}|${filters.sort}|${refreshToken}`;
  const [appliedKey, setAppliedKey] = useState(requestKey);
  if (appliedKey !== requestKey) {
    setAppliedKey(requestKey);
    setState(LOADING_STATE);
  }

  useEffect(() => {
    let cancelled = false;
    void getIdToken()
      .then((idToken) => fetchPatterns(idToken, filters))
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState({ ...LOADING_STATE, isLoading: false, error: "Could not verify your session." });
        } else if (!result.ok) {
          setState({ ...LOADING_STATE, isLoading: false, error: result.error.message });
        } else {
          setState({ patterns: result.patterns, summary: result.summary, isLoading: false, error: null });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `requestKey` covers every filter field
  }, [getIdToken, requestKey]);

  return {
    ...state,
    filters,
    setFilters,
    refresh: () => setRefreshToken((n) => n + 1),
  };
}
