"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { AiResolution, ConversionFailure, FailurePattern } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { ProviderId } from "@/lib/ai/types";

type WithId<T> = T & { id: string };
export type ReviewDecision = "accepted" | "rejected";

type DetailResponse =
  | { ok: true; pattern: WithId<FailurePattern>; occurrences: WithId<ConversionFailure>[]; resolutions: WithId<AiResolution>[] }
  | { ok: false; error: SafeErrorResponse };

type ResolveResponse =
  | { ok: true; resolution: WithId<AiResolution>; reused: boolean }
  | { ok: false; error: SafeErrorResponse };

type ReviewResponse =
  | { ok: true; resolution: WithId<AiResolution>; alreadyReviewed: boolean }
  | { ok: false; error: SafeErrorResponse };

interface DetailState {
  pattern: WithId<FailurePattern> | null;
  occurrences: WithId<ConversionFailure>[];
  resolutions: WithId<AiResolution>[];
  isLoading: boolean;
  error: string | null;
  notFound: boolean;
}

const LOADING_STATE: DetailState = {
  pattern: null,
  occurrences: [],
  resolutions: [],
  isLoading: true,
  error: null,
  notFound: false,
};

const SESSION_ERROR: SafeErrorResponse = { code: "AUTHENTICATION_ERROR", message: "Could not verify your session." };
const UNREACHABLE_ERROR: SafeErrorResponse = { code: "UNKNOWN_ERROR", message: "Could not reach the server." };

async function authedJson<T>(idToken: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${idToken}` },
  });
  return (await response.json()) as T;
}

/**
 * Single data source for the admin pattern-detail page: the pattern, its
 * recent occurrences, and every AI resolution recorded against it
 * (`GET /api/admin/conversion-failures/[patternId]`), plus the two mutations
 * that page can trigger. A successful resolve/review merges the returned
 * resolution into local state instead of refetching the whole page — the
 * detail view updates without a reload or a second round trip.
 */
export function useConversionFailureDetail(patternId: string) {
  const { getIdToken } = useAuth();
  const [state, setState] = useState<DetailState>(LOADING_STATE);
  const [refreshToken, setRefreshToken] = useState(0);

  const requestKey = `${patternId}|${refreshToken}`;
  const [appliedKey, setAppliedKey] = useState(requestKey);
  if (appliedKey !== requestKey) {
    setAppliedKey(requestKey);
    setState(LOADING_STATE);
  }

  useEffect(() => {
    let cancelled = false;
    void getIdToken()
      .then((idToken) => (idToken ? authedJson<DetailResponse>(idToken, `/api/admin/conversion-failures/${patternId}`) : null))
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState({ ...LOADING_STATE, isLoading: false, error: SESSION_ERROR.message });
        } else if (!result.ok) {
          setState({
            ...LOADING_STATE,
            isLoading: false,
            error: result.error.message,
            notFound: result.error.code === "NOT_FOUND_ERROR",
          });
        } else {
          setState({
            pattern: result.pattern,
            occurrences: result.occurrences,
            resolutions: result.resolutions,
            isLoading: false,
            error: null,
            notFound: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ ...LOADING_STATE, isLoading: false, error: UNREACHABLE_ERROR.message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `requestKey` covers both `patternId` and the refresh counter
  }, [getIdToken, requestKey]);

  const upsertResolution = useCallback((resolution: WithId<AiResolution>) => {
    setState((current) => {
      const exists = current.resolutions.some((entry) => entry.id === resolution.id);
      return {
        ...current,
        resolutions: exists
          ? current.resolutions.map((entry) => (entry.id === resolution.id ? resolution : entry))
          : [resolution, ...current.resolutions],
      };
    });
  }, []);

  const resolve = useCallback(
    async (provider: ProviderId): Promise<{ error: SafeErrorResponse | null; reused: boolean }> => {
      const idToken = await getIdToken();
      if (!idToken) return { error: SESSION_ERROR, reused: false };
      try {
        const result = await authedJson<ResolveResponse>(idToken, `/api/admin/conversion-failures/${patternId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        if (!result.ok) return { error: result.error, reused: false };
        upsertResolution(result.resolution);
        return { error: null, reused: result.reused };
      } catch {
        return { error: UNREACHABLE_ERROR, reused: false };
      }
    },
    [getIdToken, patternId, upsertResolution],
  );

  const review = useCallback(
    async (resolutionId: string, decision: ReviewDecision, reviewNote: string | null): Promise<SafeErrorResponse | null> => {
      const idToken = await getIdToken();
      if (!idToken) return SESSION_ERROR;
      try {
        const result = await authedJson<ReviewResponse>(idToken, `/api/admin/conversion-failures/${patternId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolutionId, decision, reviewNote }),
        });
        if (!result.ok) return result.error;
        upsertResolution(result.resolution);
        return null;
      } catch {
        return UNREACHABLE_ERROR;
      }
    },
    [getIdToken, patternId, upsertResolution],
  );

  return { ...state, resolve, review, refresh: () => setRefreshToken((n) => n + 1) };
}
