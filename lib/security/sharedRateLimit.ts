/**
 * The rate limiter every route calls: the per-instance limiter first, then
 * one shared Firestore window counter that holds across instances.
 *
 * ## Why two layers
 *
 * The deployment is Vercel — serverless, potentially many concurrent
 * instances. `checkRateLimit` (`./rateLimit.ts`) keeps its windows in module
 * memory, so on its own the ceiling is `limit × instance count` and resets
 * on every cold start (threat model finding 3). The shared layer is one
 * Firestore document per caller per window
 * (`rateLimitWindows/{sha256(key)}_{windowStart}`), reserved
 * transactionally through `lib/firebase/sharedCounter.ts`, which every
 * instance sees.
 *
 * The in-memory check still runs first, because it is free: a caller
 * hammering one instance is refused there without a Firestore read. Only a
 * request the local window admits pays for the shared check — one read, and
 * one write if admitted. A shared refusal writes nothing.
 *
 * ## What happens when the shared layer cannot answer
 *
 * - **Firebase not configured** (local dev, tests, a deployment before
 *   setup): the local verdict stands. Routes like document extraction must
 *   work with no Firebase project at all.
 * - **Firestore errors** (outage, sustained contention on one window
 *   document): logged, and the local verdict stands. That degrades to the
 *   per-instance bound this app had before — never to no bound — and a
 *   Firestore outage does not take down routes that never needed Firestore.
 *   The AI call budget makes the opposite choice and fails closed
 *   (`lib/ai/costCap.ts`), because a wrong "yes" there costs money.
 *
 * ## The unknown-caller bucket is never shared
 *
 * `getRequestIp` returns `UNKNOWN_CLIENT_IP` when no proxy header is
 * present. Shared, that bucket would be one window for every unidentified
 * caller on every instance — the whole internet at 30 requests per five
 * minutes. It stays per-instance (threat model finding 4).
 *
 * ## Privacy
 *
 * The document id carries a SHA-256 of the key, not the key, so no IP or
 * uid is stored in clear. A hash of an IPv4 address is brute-forceable, so
 * this is not anonymisation; it keeps addresses out of casual view, and the
 * documents are server-only and deleted by TTL once their window has passed.
 */
import { createHash } from "node:crypto";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { firestoreCounterStore } from "@/lib/firebase/sharedCounter";
import { logAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";
import type { CounterStore } from "./counterStore";
import {
  checkRateLimit,
  getRequestIp,
  UNKNOWN_CLIENT_IP,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rateLimit";

export const RATE_LIMIT_COLLECTION = "rateLimitWindows";

export interface SharedRateLimitOptions extends RateLimitOptions {
  /** False keeps this check per-instance. Set from `rateLimitIdentity(...).shared`. Defaults to true. */
  readonly shared?: boolean;
}

export interface SharedRateLimitDeps {
  /** Null when there is no shared store to use; the local verdict then stands. */
  readonly store: CounterStore | null;
  readonly now: () => number;
}

function defaultDeps(): SharedRateLimitDeps {
  return { store: isFirebaseAdminConfigured ? firestoreCounterStore : null, now: Date.now };
}

/** Firestore document id for one caller's window. Exported for the test. */
export function windowDocId(key: string, windowStart: number): string {
  return `${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 40)}_${windowStart}`;
}

/**
 * Check-and-increment, once per request, before the expensive work.
 *
 * Shared windows are aligned to multiples of `windowMs` so every instance
 * agrees on which document is current without coordinating.
 */
export async function checkSharedRateLimit(
  options: SharedRateLimitOptions,
  deps: SharedRateLimitDeps = defaultDeps(),
): Promise<RateLimitResult> {
  const local = checkRateLimit(options);
  if (!local.ok) return local;
  if (options.shared === false || deps.store === null) return local;

  const now = deps.now();
  const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
  const windowEnd = windowStart + options.windowMs;

  try {
    const outcome = await deps.store.reserve({
      collection: RATE_LIMIT_COLLECTION,
      docId: windowDocId(options.key, windowStart),
      limit: options.limit,
      expireAt: new Date(windowEnd),
    });
    if (outcome.admitted) return local;
    return {
      ok: false,
      error: AppErrors.rateLimit("Too many requests — please wait a moment and try again.", {
        details: { retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1000)) },
      }),
    };
  } catch (cause) {
    logAppError(
      {
        code: "DATABASE_ERROR",
        message: "Shared rate-limit check failed; the per-instance limit was applied instead.",
        debug: cause,
      },
      { route: "lib/security/sharedRateLimit" },
    );
    return local;
  }
}

/**
 * Who a request counts as, for rate limiting: the verified uid when signed
 * in, else the client IP. `shared` is false for the unknown-IP bucket, which
 * must not become one window for every unidentified caller on every
 * instance.
 */
export function rateLimitIdentity(
  request: Request,
  user: { readonly uid: string } | null,
): { readonly id: string; readonly shared: boolean } {
  if (user) return { id: `uid:${user.uid}`, shared: true };
  const ip = getRequestIp(request);
  return { id: `ip:${ip}`, shared: ip !== UNKNOWN_CLIENT_IP };
}
