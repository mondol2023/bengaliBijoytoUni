/**
 * Centralized, typed error model for the whole platform.
 *
 * Every domain engine (conversion, comparison, documents, usage) and every
 * API route handler should raise/return one of these instead of a bare
 * `Error` or a stringly-typed failure. `message` is always safe to show a
 * user; `debug` carries anything sensitive/internal and must be stripped
 * before crossing to the client (see `handlers.ts`).
 */

export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "FILE_PROCESSING_ERROR"
  | "CONVERSION_ERROR"
  | "LIMIT_EXCEEDED_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "RATE_LIMIT_ERROR"
  | "NOT_FOUND_ERROR"
  | "CONFLICT_ERROR"
  | "STORAGE_ERROR"
  | "DATABASE_ERROR"
  | "UNKNOWN_ERROR";

interface BaseAppError<TCode extends AppErrorCode, TDetails = undefined> {
  readonly code: TCode;
  /** User-facing, safe to render as-is. Never contains stack traces or internals. */
  readonly message: string;
  /** Server-only diagnostic payload. Must never be sent to the client. */
  readonly debug?: unknown;
  readonly details?: TDetails;
}

export type ValidationError = BaseAppError<"VALIDATION_ERROR", { field?: string }>;

export type FileProcessingError = BaseAppError<
  "FILE_PROCESSING_ERROR",
  {
    fileName?: string;
    fileType?: string;
    reason:
      | "unsupported_format"
      | "corrupted"
      | "empty"
      | "extraction_failed"
      | "too_large"
      | "unreliable_format";
  }
>;

export type ConversionError = BaseAppError<
  "CONVERSION_ERROR",
  { encodingId?: string; unmappedSequences?: string[] }
>;

export type LimitExceededError = BaseAppError<
  "LIMIT_EXCEEDED_ERROR",
  { tier: string; used: number; max: number }
>;

export type AuthenticationError = BaseAppError<"AUTHENTICATION_ERROR">;

export type AuthorizationError = BaseAppError<"AUTHORIZATION_ERROR">;

export type RateLimitError = BaseAppError<"RATE_LIMIT_ERROR", { retryAfterSeconds: number }>;

/** A referenced resource (e.g. a `failurePatterns` doc) does not exist — no route needed this until Phase 6's resolve endpoint. */
export type NotFoundError = BaseAppError<"NOT_FOUND_ERROR">;

/** Another request is already acting on the same resource (e.g. an in-flight AI resolution claim) — see `lib/ai/resolveConversionFailure.ts`. */
export type ConflictError = BaseAppError<"CONFLICT_ERROR">;

export type StorageError = BaseAppError<"STORAGE_ERROR">;

export type DatabaseError = BaseAppError<"DATABASE_ERROR">;

export type UnknownError = BaseAppError<"UNKNOWN_ERROR">;

export type AppError =
  | ValidationError
  | FileProcessingError
  | ConversionError
  | LimitExceededError
  | AuthenticationError
  | AuthorizationError
  | RateLimitError
  | NotFoundError
  | ConflictError
  | StorageError
  | DatabaseError
  | UnknownError;

/** Discriminated-union result type used across engines instead of throwing. */
export type Result<T, E extends AppError = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

function makeError<TCode extends AppErrorCode>(code: TCode) {
  return (message: string, extra?: Omit<Extract<AppError, { code: TCode }>, "code" | "message">) =>
    ({ code, message, ...extra }) as Extract<AppError, { code: TCode }>;
}

/** Convenience constructors so call sites don't hand-roll the object shape. */
export const AppErrors = {
  validation: makeError("VALIDATION_ERROR"),
  fileProcessing: makeError("FILE_PROCESSING_ERROR"),
  conversion: makeError("CONVERSION_ERROR"),
  limitExceeded: makeError("LIMIT_EXCEEDED_ERROR"),
  authentication: makeError("AUTHENTICATION_ERROR"),
  authorization: makeError("AUTHORIZATION_ERROR"),
  rateLimit: makeError("RATE_LIMIT_ERROR"),
  notFound: makeError("NOT_FOUND_ERROR"),
  conflict: makeError("CONFLICT_ERROR"),
  storage: makeError("STORAGE_ERROR"),
  database: makeError("DATABASE_ERROR"),
  unknown: makeError("UNKNOWN_ERROR"),
};
