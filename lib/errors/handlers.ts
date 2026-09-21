import { AppError, AppErrors, Result, type AppErrorCode } from "./types";

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
    case "NOT_FOUND_ERROR":
      return 404;
    case "CONFLICT_ERROR":
      return 409;
    case "FILE_PROCESSING_ERROR":
    case "CONVERSION_ERROR":
      return 422;
    case "LIMIT_EXCEEDED_ERROR":
      return 413;
    case "STORAGE_ERROR":
    case "DATABASE_ERROR":
    case "UNKNOWN_ERROR":
      return 500;
    default:
      // Unreachable for a well-typed AppError (the cases above are
      // exhaustive), but a switch with no default returns `undefined` at
      // runtime, and `NextResponse.json(body, { status: undefined })`
      // silently sends 200 — an error reported as a success. The
      // `never` binding keeps the compiler enforcing exhaustiveness, so a
      // newly added `AppErrorCode` is still a type error here rather than
      // quietly falling into this branch.
      error satisfies never;
      return 500;
  }
}

/**
 * The runtime counterpart to the `AppErrorCode` union. Needed because
 * `toAppError` has to tell one of *our* errors from a third-party one at
 * runtime, and a bare `"code" in cause` check can't: a Firestore/Firebase
 * error is also `{ code, message }`, so duck-typing on shape alone used to
 * pass `{ code: "permission-denied", message: "Missing or insufficient
 * permissions on /users/abc" }` straight through as if it were an AppError.
 * That leaked an internal message to the client as a "user-safe" one and
 * left `statusForAppError` with no matching case, which returned `undefined`
 * and sent the failure out as HTTP 200.
 */
const APP_ERROR_CODES = new Set<string>([
  "VALIDATION_ERROR",
  "FILE_PROCESSING_ERROR",
  "CONVERSION_ERROR",
  "LIMIT_EXCEEDED_ERROR",
  "AUTHENTICATION_ERROR",
  "AUTHORIZATION_ERROR",
  "RATE_LIMIT_ERROR",
  "NOT_FOUND_ERROR",
  "CONFLICT_ERROR",
  "STORAGE_ERROR",
  "DATABASE_ERROR",
  "UNKNOWN_ERROR",
] satisfies AppErrorCode[]);

/** True only for an error this codebase raised — never for a look-alike from a third-party SDK. */
export function isAppError(cause: unknown): cause is AppError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { code: unknown }).code === "string" &&
    APP_ERROR_CODES.has((cause as { code: string }).code) &&
    "message" in cause &&
    typeof (cause as { message: unknown }).message === "string"
  );
}

/**
 * Normalizes any thrown value into an AppError, for boundaries around
 * 3rd-party calls. Anything that isn't recognizably one of ours becomes an
 * `UNKNOWN_ERROR` carrying `fallbackMessage` — the original is preserved in
 * `debug`, which `toSafeResponse` strips, so the caller still gets the
 * detail in the server log without it crossing to the client.
 */
export function toAppError(cause: unknown, fallbackMessage = "Something went wrong."): AppError {
  if (isAppError(cause)) return cause;
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

/**
 * The one place an `AppError` becomes an HTTP response. Every `/api/*` route
 * used to carry a byte-identical private `fail()` helper differing only in
 * the route string it logged (21 copies at last count), which meant the
 * response contract — status, body shape, headers — had 21 places it could
 * drift. Routes now do `const fail = failResponder("api/whatever")`.
 *
 * Centralizing it also makes cross-cutting response concerns practical: a
 * `RATE_LIMIT_ERROR` already computes `retryAfterSeconds` for its body, and
 * this is the only sensible place to also put it on the `Retry-After` header
 * where a client or proxy will actually honor it.
 */
export function failResponder(route: string) {
  return (error: AppError): Response => {
    logAppError(error, { route });
    const headers: Record<string, string> =
      error.code === "RATE_LIMIT_ERROR" && typeof error.details?.retryAfterSeconds === "number"
        ? { "Retry-After": String(error.details.retryAfterSeconds) }
        : {};
    return Response.json(
      { ok: false, error: toSafeResponse(error) },
      { status: statusForAppError(error), headers },
    );
  };
}
