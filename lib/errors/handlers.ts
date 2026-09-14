import { AppError, AppErrors, Result } from "./types";

/** Shape actually sent to the browser — never includes `debug`. */
export interface SafeErrorResponse {
  code: AppError["code"];
  message: string;
  details?: AppError["details"];
}

/** Strips server-only diagnostics before an error crosses to the client. */
export function toSafeResponse(error: AppError): SafeErrorResponse {
  return { code: error.code, message: error.message, details: error.details };
}

/**
 * Logs the full error (including `debug`) server-side. Swap the body for a
 * real logger/telemetry sink later without touching call sites.
 */
export function logAppError(error: AppError, context?: Record<string, unknown>) {
  console.error(`[${error.code}] ${error.message}`, {
    details: error.details,
    debug: error.debug,
    ...context,
  });
}

/**
 * Maps an `AppError` to an HTTP status code. Every API route was hand-rolling
 * this identical switch (extraction, comparison, and now auth/persistence
 * routes) — centralized here once the duplication grew past a couple of call
 * sites, so a new `AppErrorCode` only needs a status decided in one place.
 */
export function statusForAppError(error: AppError): number {
  switch (error.code) {
    case "VALIDATION_ERROR":
      return 400;
    case "AUTHENTICATION_ERROR":
      return 401;
    case "AUTHORIZATION_ERROR":
      return 403;
    case "RATE_LIMIT_ERROR":
      return 429;
    case "FILE_PROCESSING_ERROR":
    case "CONVERSION_ERROR":
      return 422;
    case "LIMIT_EXCEEDED_ERROR":
      return 413;
    case "STORAGE_ERROR":
    case "DATABASE_ERROR":
    case "UNKNOWN_ERROR":
      return 500;
  }
}

/** Normalizes any thrown value into an AppError, for boundaries around 3rd-party calls. */
export function toAppError(cause: unknown, fallbackMessage = "Something went wrong."): AppError {
  if (cause && typeof cause === "object" && "code" in cause && "message" in cause) {
    return cause as AppError;
  }
  return AppErrors.unknown(fallbackMessage, { debug: cause });
}

/** Runs `fn`, converting any throw into a typed `Result` instead of propagating. */
export async function toResult<T>(
  fn: () => Promise<T> | T,
  fallbackMessage?: string,
): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (cause) {
    return { ok: false, error: toAppError(cause, fallbackMessage) };
  }
}
