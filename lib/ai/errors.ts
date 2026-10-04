import { AppErrors, type AppError } from "../errors/types";
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

/** A provider's finish/block reason: a short enum token, never prose. */
const ENUM_TOKEN = /^[A-Za-z_]{1,40}$/;

/**
 * What a log may keep of a 200 response an adapter could not read text out
 * of: its top-level keys and the provider's own enum reasons. Never the body
 * — `debug` is printed by `logAppError`, and an unreadable body is still a
 * model response that can carry generated text in a field the adapter does
 * not read (a refusal, a tool call, a second part).
 */
export function unreadableResponseDebug(
  reason: string,
  body: unknown,
  reasons: Record<string, unknown>,
): { reason: string; topLevelKeys: string[]; reasons: Record<string, string> } {
  const topLevelKeys =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? Object.keys(body).filter((key) => ENUM_TOKEN.test(key))
      : [];
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(reasons)) {
    if (typeof value === "string" && ENUM_TOKEN.test(value)) kept[name] = value;
  }
  return { reason, topLevelKeys, reasons: kept };
}

export const ProviderErrors = {
  /**
   * The deployment-wide kill switch is off (`lib/ai/enabled.ts`). Distinct
   * from `provider_not_configured`: that one means "this provider has no key",
   * which an admin fixes by adding a key. This one means "no provider may be
   * called here at all", which adding a key must never fix.
   */
  disabled(feature = "AI resolution"): ProviderError {
    return {
      code: "provider_disabled",
      provider: null,
      message: `${feature} is disabled on this deployment.`,
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

/** Maps a Phase 5 `ProviderError` to the app-wide safe error model (§19) — never a generic 500 where a more precise status exists, never `debug`/API-key material leaking into the response. */
export function providerErrorToAppError(error: ProviderError): AppError {
  switch (error.code) {
    case "provider_rate_limited":
      return AppErrors.rateLimit(error.message, { details: { retryAfterSeconds: error.retryAfterSeconds ?? 60 } });
    case "provider_not_registered":
    case "provider_content_rejected":
      return AppErrors.validation(error.message);
    // 404, not 500: the deployment-wide switch being off is a deliberate
    // configuration, not a fault, and the endpoint genuinely offers nothing
    // here. It also keeps a disabled deployment from confirming which
    // providers exist, matching the check's placement in `registry.ts`.
    case "provider_disabled":
      return AppErrors.notFound(error.message);
    // 429 with the other throttles: a caller who waits gets served, which is
    // what a rate-limit status means and what the UI already handles.
    case "provider_budget_exhausted":
      return AppErrors.rateLimit(error.message, { details: { retryAfterSeconds: 3_600 } });
    case "provider_budget_unavailable":
    case "provider_not_configured":
    case "provider_authentication_failed":
    case "provider_timeout":
    case "provider_unavailable":
    case "provider_invalid_response":
    case "provider_unknown_error":
      return AppErrors.unknown(error.message, { debug: error.debug });
  }
}
