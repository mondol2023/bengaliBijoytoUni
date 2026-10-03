/**
 * The per-instance layer of rate limiting: fixed-window counting, in memory.
 * Routes do not call this directly any more — they call
 * `checkSharedRateLimit` (`./sharedRateLimit.ts`), which runs this first and
 * then a Firestore window counter shared by every instance.
 *
 * On its own this is not a deployment-wide limit. The deployment is Vercel
 * (serverless, potentially many instances), so each instance enforces its
 * own window, the effective ceiling is `limit × instance count`, and every
 * counter resets on a cold start/redeploy. It stays as the first layer
 * because it is free: a caller hammering one instance is refused here
 * without a Firestore read. And it is the bound that remains when the shared
 * layer cannot answer — Firebase not configured, or Firestore failing.
 */
import { AppErrors } from "@/lib/errors/types";
import type { RateLimitError } from "@/lib/errors/types";

interface Bucket {
  count: number;
  windowStartedAt: number;
  /** When this bucket's window closes. Stored per-bucket because `windowMs` varies per call site, so the pruner can't derive it. */
  expiresAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounds memory when many distinct keys (e.g. IPs) show up over the process
// lifetime — without this, an attacker rotating source IPs could grow this
// map without limit. A cheap size cap is enough here; entries are tiny and
// naturally expire out of relevance once their window passes.
const MAX_TRACKED_KEYS = 50_000;

/**
 * Drops buckets whose window has already closed — and only those. An earlier
 * version tested `now - bucket.windowStartedAt > 0`, which is true for every
 * bucket created at least a millisecond ago, so crossing the cap flushed the
 * whole map including live windows. That turned the memory guard into a
 * rate-limit bypass: anyone able to push the map past `MAX_TRACKED_KEYS`
 * (rotating source IPs on an anonymous route is enough) also reset every
 * other caller's counter.
 *
 * Throttled to at most one pass per `SWEEP_INTERVAL_MS`, because a saturated
 * map would otherwise sweep all 50k entries on every single request — which
 * would make a key-flood cost the server far more than it costs the
 * attacker, turning the memory guard into an amplifier for the attack it is
 * meant to bound. The cost of throttling is that a key can stay refused for
 * up to a second after space actually frees up; that is the right trade for
 * a coarse abuse guard.
 */
let nextSweepAt = 0;
const SWEEP_INTERVAL_MS = 1_000;

function pruneExpired(now: number) {
  if (now < nextSweepAt) return;
  nextSweepAt = now + SWEEP_INTERVAL_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** Identifies the caller + route together, e.g. `extract:203.0.113.4` or `extract:uid:abc123`. */
  key: string;
  /** Max requests allowed within `windowMs`. */
  limit: number;
  windowMs: number;
}

export type RateLimitResult = { ok: true } | { ok: false; error: RateLimitError };

/** Fixed-window check-and-increment. Call once per request, before doing the expensive work. */
export function checkRateLimit({ key, limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartedAt >= windowMs) {
    pruneExpired(now);

    // Admitting a new key past the cap would mean evicting a live window to
    // make room, and whichever one we picked, its owner's counter would
    // silently reset — the bypass this whole guard exists to prevent. So
    // when the map is genuinely full of live windows, refuse the *new* key
    // instead. Callers already tracked are unaffected (they reuse their
    // bucket and add no entry), which keeps the failure pointed at the
    // flood rather than at everyone else.
    if (!existing && buckets.size >= MAX_TRACKED_KEYS) {
      return {
        ok: false,
        error: AppErrors.rateLimit("Too many requests — please wait a moment and try again.", {
          details: { retryAfterSeconds: Math.ceil(windowMs / 1000) },
          debug: { reason: "rate_limit_key_capacity_reached", trackedKeys: buckets.size },
        }),
      };
    }

    buckets.set(key, { count: 1, windowStartedAt: now, expiresAt: now + windowMs });
    return { ok: true };
  }

  if (existing.count < limit) {
    existing.count += 1;
    return { ok: true };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStartedAt + windowMs - now) / 1000));
  return {
    ok: false,
    error: AppErrors.rateLimit("Too many requests — please wait a moment and try again.", {
      details: { retryAfterSeconds },
    }),
  };
}

/** What `getRequestIp` returns when no proxy header names the client. Never shared across instances — see `sharedRateLimit.ts`. */
export const UNKNOWN_CLIENT_IP = "unknown";

/**
 * Best-effort client identifier for rate-limiting purposes only — never used
 * for authorization or attribution.
 *
 * The deployment is Vercel, and the order below follows Vercel's documented
 * request headers (https://vercel.com/docs/headers/request-headers):
 *
 * 1. `x-vercel-forwarded-for`, **only when running on Vercel** (`VERCEL=1`).
 *    Vercel sets it to the client's public IP, and unlike
 *    `x-forwarded-for` it survives a proxy placed in front of Vercel. Off
 *    Vercel nothing sets it, so a client could forge it — hence the gate.
 * 2. `x-forwarded-for`. On Vercel, the platform *overwrites* any value the
 *    client sent ("we currently overwrite the X-Forwarded-For header and do
 *    not forward external IPs ... to prevent IP spoofing"), so the first
 *    entry is the real client. Elsewhere it is only as trustworthy as the
 *    proxy in front of the app.
 * 3. `x-real-ip`, which Vercel documents as identical to `x-forwarded-for`.
 * 4. `UNKNOWN_CLIENT_IP`, a constant bucket. On Vercel one of the headers
 *    above is always present, so this is a local-dev and misconfiguration
 *    path; `sharedRateLimit.ts` keeps this bucket per-instance so it never
 *    becomes one shared window for every unidentified caller.
 *
 * `onVercel` is a parameter only so the test can drive both branches.
 */
export function getRequestIp(request: Request, onVercel: boolean = process.env.VERCEL === "1"): string {
  if (onVercel) {
    const vercelForwardedFor = firstAddress(request.headers.get("x-vercel-forwarded-for"));
    if (vercelForwardedFor) return vercelForwardedFor;
  }
  const forwardedFor = firstAddress(request.headers.get("x-forwarded-for"));
  if (forwardedFor) return forwardedFor;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return UNKNOWN_CLIENT_IP;
}

function firstAddress(header: string | null): string | null {
  const first = header?.split(",")[0]?.trim();
  return first ? first : null;
}
