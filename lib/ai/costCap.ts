/**
 * A daily ceiling on outbound provider calls, and the reason it counts calls
 * rather than currency.
 *
 * **It is a call budget, not a money budget.** Nothing in this repository
 * records a per-token or per-call price for any provider, and the prices
 * change without us. A cap denominated in dollars would therefore be a
 * number somebody typed next to an arithmetic we cannot check — worse than
 * no cap, because it would read like a guarantee. Calls are the quantity
 * this code can actually count. `estimatedCostPerCall` exists for an
 * operator who *does* know their price and wants the projection reported;
 * it never affects the decision.
 *
 * **It fails closed.** A budget of zero, a negative budget, an unparseable
 * environment value and an exhausted day all refuse the call. The one thing
 * it will not do is let a misconfiguration read as "unlimited".
 *
 * **It is per-instance**, exactly like `lib/security/rateLimit.ts`, and for
 * the same reason: the map lives in module memory and dies on a cold start.
 * On a multi-instance host the effective ceiling is the budget times the
 * instance count. That is stated rather than hidden
 * (`docs/threat-model-public-failure-endpoints.md` §3 makes the same point
 * about the rate limiter). It is a weaker bound than it looks, and it is
 * still worth having here because the route behind it is admin-only and
 * already rate-limited to `RESOLUTION_LIMITS.resolveRateLimit` — this is the
 * backstop for a script or a loop, not for an anonymous crowd. A cap that
 * holds across instances needs shared state and belongs with the same
 * decision as a shared rate limiter.
 */
import { ProviderErrors, type ProviderError } from "./errors";
import { RESOLUTION_LIMITS } from "./limits";

export const AI_DAILY_CALL_BUDGET_ENV = "AI_DAILY_CALL_BUDGET";

/** UTC, so the reset instant does not move with a deployment's region. */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The budget when the environment does not set one.
 *
 * Derived rather than picked: the resolve route already allows
 * `resolveRateLimit` (20) calls per 10-minute window per admin. 100 is five
 * of those windows — a long, deliberate review session — and an order of
 * magnitude below the ~2,880 a day that limit alone would permit. An
 * operator who wants more sets the variable; that is the point of having a
 * variable.
 */
export const DEFAULT_DAILY_CALL_BUDGET = 5 * RESOLUTION_LIMITS.resolveRateLimit.limit;

/**
 * Reads the configured budget. An unset value takes the default; anything
 * present but not a non-negative integer is treated as zero, because a typo
 * in a spending limit must not read as a larger limit.
 */
export function configuredDailyCallBudget(
  raw: string | undefined = process.env[AI_DAILY_CALL_BUDGET_ENV],
): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_CALL_BUDGET;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

export interface DailyCallBudgetOptions {
  /** Defaults to `configuredDailyCallBudget()`, read at reserve time. */
  readonly maxCallsPerDay?: () => number;
  /** Injectable for tests; defaults to `Date`. */
  readonly now?: () => Date;
  /** Optional, operator-supplied, reporting only — never part of the decision. */
  readonly estimatedCostPerCall?: number;
}

export interface BudgetUsage {
  readonly day: string;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  /** `used × estimatedCostPerCall`, or null when no price was configured. */
  readonly estimatedCost: number | null;
}

export interface DailyCallBudget {
  /**
   * Takes one call's worth of budget, or refuses. Incrementing before the
   * call rather than after is what makes two concurrent callers unable to
   * both take the last unit.
   */
  reserve(): { ok: true; usage: BudgetUsage } | { ok: false; error: ProviderError };
  /** Gives a reservation back when the call turned out not to happen. */
  release(): void;
  usage(): BudgetUsage;
}

export function createDailyCallBudget(options: DailyCallBudgetOptions = {}): DailyCallBudget {
  const now = options.now ?? (() => new Date());
  const limitOf = options.maxCallsPerDay ?? (() => configuredDailyCallBudget());
  let day = utcDayKey(now());
  let used = 0;

  function rollOver(): void {
    const today = utcDayKey(now());
    if (today !== day) {
      day = today;
      used = 0;
    }
  }

  function snapshot(limit: number): BudgetUsage {
    return {
      day,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      estimatedCost:
        typeof options.estimatedCostPerCall === "number" ? used * options.estimatedCostPerCall : null,
    };
  }

  return {
    reserve() {
      rollOver();
      const limit = limitOf();
      if (used >= limit) {
        return {
          ok: false,
          error: ProviderErrors.budgetExhausted(limit, day),
        };
      }
      used += 1;
      return { ok: true, usage: snapshot(limit) };
    },
    release() {
      rollOver();
      if (used > 0) used -= 1;
    },
    usage() {
      rollOver();
      return snapshot(limitOf());
    },
  };
}

/** The process-wide budget the resolution path uses. */
export const dailyCallBudget = createDailyCallBudget();
