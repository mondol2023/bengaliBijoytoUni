/**
 * Bounded retries with backoff for one provider call.
 *
 * Which failures may be retried is the whole design, and it is a short list.
 * A timeout or an unavailable service is a statement about *now*; the same
 * request a second later is a different question. An authentication failure,
 * a rejected payload or an unparseable response are statements about the
 * request itself, and retrying them spends money to be told the same thing
 * again. `provider_rate_limited` sits between the two: it is transient, but
 * retrying it immediately is what caused it, so it is retried only after the
 * provider's own `retryAfterSeconds` when one is given.
 *
 * Full jitter rather than plain exponential backoff. Several admins
 * resolving at once, or one admin retrying a page, produce correlated
 * retries; a fixed schedule lines them up on the same instants, which is the
 * shape that turns a brief outage into a sustained one.
 *
 * Nothing here is server-only — it holds no credential and no Firestore
 * handle, just arithmetic and a sleep — so it stays testable with fake
 * timers and no provider at all.
 */
import type { ProviderError } from "./errors";
import type { ProviderResult } from "./types";

export interface RetryPolicy {
  /** Total attempts including the first. 1 disables retrying. */
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/**
 * Three attempts, because the failure this exists for is a single dropped
 * connection or one instance restarting, and a third attempt that also fails
 * is evidence of something a fourth will not fix. The delays keep the whole
 * sequence inside a request an admin is waiting on: at most 0.5s + 1s of
 * sleeping on top of the provider's own timeout.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
};

export interface WithRetryOptions extends Partial<RetryPolicy> {
  /** Injectable for tests; defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to `Math.random`. */
  readonly random?: () => number;
  /** Called before each wait, for logging. Never receives a credential. */
  readonly onRetry?: (info: { attempt: number; delayMs: number; error: ProviderError }) => void;
}

/**
 * A failure that says something about the moment rather than about the
 * request. Exported because the list is the policy, and a test should be
 * able to assert it rather than infer it from behaviour.
 */
export function isRetryableProviderError(error: ProviderError): boolean {
  switch (error.code) {
    case "provider_timeout":
    case "provider_unavailable":
    case "provider_rate_limited":
      return true;
    case "provider_disabled":
    case "provider_not_registered":
    case "provider_not_configured":
    case "provider_authentication_failed":
    case "provider_invalid_response":
    case "provider_content_rejected":
    case "provider_unknown_error":
      return false;
    default:
      // A code added later is not retried until someone decides it should
      // be: an unknown failure repeated is an unknown failure billed twice.
      return false;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The wait before attempt `attempt` (1-based, so attempt 1 never waits).
 * Full jitter: a uniform draw from [0, capped], not the cap itself.
 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
  error: ProviderError,
): number {
  if (typeof error.retryAfterSeconds === "number" && error.retryAfterSeconds >= 0) {
    // The provider told us when. Guessing earlier is how a 429 becomes a ban.
    return Math.min(error.retryAfterSeconds * 1_000, policy.maxDelayMs);
  }
  const capped = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return Math.floor(random() * capped);
}

export async function withProviderRetry<T>(
  call: (attempt: number) => Promise<ProviderResult<T>>,
  options: WithRetryOptions = {},
): Promise<ProviderResult<T>> {
  const policy: RetryPolicy = {
    attempts: options.attempts ?? DEFAULT_RETRY_POLICY.attempts,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
  };
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let last: ProviderResult<T> | undefined;
  for (let attempt = 1; attempt <= Math.max(1, policy.attempts); attempt += 1) {
    last = await call(attempt);
    if (last.ok) return last;
    if (attempt >= policy.attempts) break;
    if (!isRetryableProviderError(last.error)) break;

    const delayMs = backoffDelayMs(attempt, policy, random, last.error);
    options.onRetry?.({ attempt, delayMs, error: last.error });
    await sleep(delayMs);
  }
  // `call` runs at least once, so this is always the last real result.
  return last as ProviderResult<T>;
}
