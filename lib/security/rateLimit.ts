/**
 * A pragmatic first layer of abuse protection for routes reachable without
 * authentication (document extraction, session creation) — fixed-window
 * counting, in memory, per server instance. This is deliberately not a
 * distributed rate limiter: on a multi-instance deployment each instance
 * enforces its own window, so the effective ceiling is `limit × instance
 * count`, and every counter resets on a cold start/redeploy. Disclosed here
 * rather than hidden, matching this codebase's existing pattern for a
 * bounded-but-honest safeguard (e.g. the admin user search's exact-match-only
 * limitation). Good enough to blunt casual scripted abuse of expensive
 * routes (PDF/DOCX parsing, Admin SDK token verification) on a single-
 * instance deployment; swap for a shared store (Redis, or a Firestore
 * transaction counter) if a multi-instance deployment needs a hard global
 * ceiling instead of a per-instance one.
 */
import { AppErrors } from "@/lib/errors/types";
import type { RateLimitError } from "@/lib/errors/types";

interface Bucket {
  count: number;
  windowStartedAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounds memory when many distinct keys (e.g. IPs) show up over the process
// lifetime — without this, an attacker rotating source IPs could grow this
// map without limit. A cheap size cap is enough here; entries are tiny and
// naturally expire out of relevance once their window passes.
const MAX_TRACKED_KEYS = 50_000;

function pruneIfNeeded(now: number) {
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt > 0) buckets.delete(key);
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
    pruneIfNeeded(now);
    buckets.set(key, { count: 1, windowStartedAt: now });
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

/**
 * Best-effort client identifier for rate-limiting purposes only — never used
 * for authorization or attribution. Reads the platform-set forwarded-for
 * header (trustworthy behind Vercel/most PaaS reverse proxies; a
 * self-hosted deployment behind a different proxy should confirm which
 * header its proxy sets) and falls back to a constant bucket so requests
 * still get *some* shared limit rather than none when no proxy header is
 * present.
 */
export function getRequestIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
