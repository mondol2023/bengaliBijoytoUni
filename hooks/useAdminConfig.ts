"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { SystemConfig } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";
import type { TierId } from "@/types/domain";

/**
 * The actual `POST /api/admin/config` wire shape — distinct from `SystemConfig`
 * itself because a tier override here can be explicitly `null` ("clear it back
 * to the built-in default"), which `SystemConfig`'s own type doesn't allow
 * (there, "no override" is simply the key being absent).
 */
export interface SystemConfigPatch {
  tierOverrides?: Partial<Record<TierId, { maxNonWhitespaceChars: number } | null>>;
  enabledEncodings?: string[];
  maxUploadSizeBytes?: number;
  featureFlags?: { documentsEnabled: boolean; comparisonEnabled: boolean };
}

export interface EncodingOption {
  id: string;
  name: string;
}

type GetResponse =
  | { ok: true; config: SystemConfig; availableEncodings: EncodingOption[] }
  | { ok: false; error: SafeErrorResponse };
type PostResponse = { ok: true; config: SystemConfig } | { ok: false; error: SafeErrorResponse };

interface ConfigState {
  config: SystemConfig | null;
  availableEncodings: EncodingOption[];
  isLoading: boolean;
  error: string | null;
}

const LOADING_STATE: ConfigState = { config: null, availableEncodings: [], isLoading: true, error: null };

async function fetchConfig(idToken: string | null): Promise<GetResponse | null> {
  if (!idToken) return null;
  const response = await fetch("/api/admin/config", { headers: { Authorization: `Bearer ${idToken}` } });
  return (await response.json()) as GetResponse;
}

export function useAdminConfig() {
  const { getIdToken } = useAuth();
  const [state, setState] = useState<ConfigState>(LOADING_STATE);
  const [refreshToken, setRefreshToken] = useState(0);

  const [appliedRefreshToken, setAppliedRefreshToken] = useState(refreshToken);
  if (appliedRefreshToken !== refreshToken) {
    setAppliedRefreshToken(refreshToken);
    setState(LOADING_STATE);
  }

  useEffect(() => {
    let cancelled = false;
    void getIdToken()
      .then(fetchConfig)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState({ config: null, availableEncodings: [], isLoading: false, error: "Could not verify your session." });
        } else if (!result.ok) {
          setState({ config: null, availableEncodings: [], isLoading: false, error: result.error.message });
        } else {
          setState({ config: result.config, availableEncodings: result.availableEncodings, isLoading: false, error: null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ config: null, availableEncodings: [], isLoading: false, error: "Could not reach the server." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getIdToken, refreshToken]);

  /** Not effect-invoked — a plain save action the config form calls on submit. */
  async function save(patch: SystemConfigPatch): Promise<SafeErrorResponse | null> {
    const idToken = await getIdToken();
    if (!idToken) return { code: "AUTHENTICATION_ERROR", message: "Sign in to continue." };
    try {
      const response = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as PostResponse;
      if (!payload.ok) return payload.error;
      setState((current) => ({ ...current, config: payload.config }));
      return null;
    } catch {
      return { code: "UNKNOWN_ERROR", message: "Could not reach the server — check your connection and try again." };
    }
  }

  return { ...state, save, refresh: () => setRefreshToken((n) => n + 1) };
}
