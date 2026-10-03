import type { ProviderId } from "./types";

/**
 * Normalized error taxonomy for the resolution pipeline, deliberately kept
 * separate from `AppErrorCode` (`lib/errors/types.ts`): these describe *why
 * a specific AI provider call failed*, a different axis than the
 * request/auth/validation errors an API route raises. `provider_not_registered`
 * is the one addition beyond `docs/conversion-failure-pipeline.md`'s list —
 * it covers `getResolutionProvider` being asked for an id with no adapter at
 * all, which is a distinct situation from a real provider that exists but
 * lacks an API key (`provider_not_configured`).
 */
export type ProviderErrorCode =
  | "provider_disabled"
  | "provider_not_registered"
  | "provider_not_configured"
  | "provider_authentication_failed"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_invalid_response"
  | "provider_content_rejected"
  | "provider_budget_exhausted"
  | "provider_budget_unavailable"
  | "provider_unknown_error";

export interface ProviderError {
  readonly code: ProviderErrorCode;
  /** Null for `provider_not_registered` and `provider_disabled`, neither of which is about one provider. */
  readonly provider: ProviderId | null;
  /** Safe to show an admin. Never contains an API key, header, or raw provider payload. */
  readonly message: string;
  /** Server-only diagnostic (e.g. the caught exception, or a non-2xx status). Never sent to a client. */
  readonly debug?: unknown;
  readonly retryAfterSeconds?: number;
}

/** Strips `debug` before a `ProviderError` could cross to a client — mirrors `lib/errors/handlers.ts#toSafeResponse`. */
export function toSafeProviderError(error: ProviderError): Omit<ProviderError, "debug"> {
  return {
    code: error.code,
    provider: error.provider,
    message: error.message,
    retryAfterSeconds: error.retryAfterSeconds,
  };
}

export const ProviderErrors = {
  /**
   * The deployment-wide kill switch is off (`lib/ai/enabled.ts`). Distinct
   * from `provider_not_configured`: that one means "this provider has no key",
   * which an admin fixes by adding a key. This one means "no provider may be
   * called here at all", which adding a key must never fix.
   */
  disabled(): ProviderError {
    return {
      code: "provider_disabled",
      provider: null,
      message: "AI resolution is disabled on this deployment.",
    };
  },
  notRegistered(id: string): ProviderError {
    return { code: "provider_not_registered", provider: null, message: `Unknown resolution provider "${id}".` };
  },
  notConfigured(provider: ProviderId): ProviderError {
    return {
      code: "provider_not_configured",
      provider,
      message: `The "${provider}" provider is not configured on this deployment.`,
    };
  },
  authenticationFailed(provider: ProviderId, debug?: unknown): ProviderError {
    return {
      code: "provider_authentication_failed",
      provider,
      message: `"${provider}" rejected this request's credentials.`,
      debug,
    };
  },
  rateLimited(provider: ProviderId, retryAfterSeconds?: number, debug?: unknown): ProviderError {
    return {
      code: "provider_rate_limited",
      provider,
      message: `"${provider}" is rate-limiting requests right now.`,
      retryAfterSeconds,
      debug,
    };
  },
  timeout(provider: ProviderId, debug?: unknown): ProviderError {
    return { code: "provider_timeout", provider, message: `"${provider}" did not respond in time.`, debug };
  },
  unavailable(provider: ProviderId, debug?: unknown): ProviderError {
    return { code: "provider_unavailable", provider, message: `"${provider}" is unavailable right now.`, debug };
  },
  invalidResponse(provider: ProviderId, debug?: unknown): ProviderError {
    return {
      code: "provider_invalid_response",
      provider,
      message: `"${provider}" returned a response that couldn't be parsed.`,
      debug,
    };
  },
  contentRejected(provider: ProviderId, debug?: unknown): ProviderError {
    return {
      code: "provider_content_rejected",
      provider,
      message: `"${provider}" declined to process this content.`,
      debug,
    };
  },
  /**
   * The deployment's daily call budget is spent (`lib/ai/costCap.ts`). Not
   * about any one provider, so `provider` is null — switching providers must
   * not be a way around it.
   */
  budgetExhausted(limit: number, day: string): ProviderError {
    return {
      code: "provider_budget_exhausted",
      provider: null,
      message: `This deployment's daily limit of ${limit} AI calls is used up for ${day} (UTC).`,
    };
  },
  /**
   * The shared budget counter could not be read or written, so whether a
   * unit is left is unknown. Refused rather than allowed: the budget fails
   * closed, and "could not check" must never read as "unlimited". Distinct
   * from `budgetExhausted` so an outage is not reported as a spent day.
   */
  budgetUnavailable(debug?: unknown): ProviderError {
    return {
      code: "provider_budget_unavailable",
      provider: null,
      message: "The AI call budget could not be checked, so no call was made. Try again shortly.",
      debug,
    };
  },
  unknown(provider: ProviderId, debug?: unknown): ProviderError {
    return { code: "provider_unknown_error", provider, message: `"${provider}" returned an unexpected error.`, debug };
  },
};

/**
 * Shared HTTP-status-to-`ProviderErrorCode` mapping for provider adapters
 * that call a plain REST endpoint (`providers/gemini.ts`, `providers/openai.ts`).
 * Kept here rather than duplicated per adapter, since the mapping itself
 * isn't provider-specific — only the request/response shapes are.
 */
export function providerErrorForHttpStatus(provider: ProviderId, status: number, debug?: unknown): ProviderError {
  if (status === 401 || status === 403) return ProviderErrors.authenticationFailed(provider, debug);
  if (status === 429) return ProviderErrors.rateLimited(provider, undefined, debug);
  if (status >= 500) return ProviderErrors.unavailable(provider, debug);
  if (status === 400) return ProviderErrors.contentRejected(provider, debug);
  return ProviderErrors.unknown(provider, debug);
}
