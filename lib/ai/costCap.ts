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
 * environment value, an exhausted day, and a counter that cannot be reached
 * all refuse the call. The one thing it will not do is let a
 * misconfiguration or an outage read as "unlimited".
 *
 * **It is deployment-wide.** The deployment is Vercel — serverless,
 * potentially many concurrent instances — so a count held in module memory
 * would bound one instance and reset on every cold start, making the real
 * ceiling the budget times the instance count. The count therefore lives in
 * a `CounterStore` (`lib/security/counterStore.ts`): one Firestore document
 * per UTC day, reserved transactionally, supplied by
 * `resolveConversionFailure.ts` — the one `lib/ai` module allowed to reach
 * Firestore. This module stays database-free, so its rules are tested
 * against the in-memory store, including two budgets sharing one store the
 * way two instances share Firestore.
 */
import { ProviderErrors, type ProviderError } from "./errors";
import { RESOLUTION_LIMITS } from "./limits";
import { createMemoryCounterStore, type CounterSlot, type CounterStore } from "@/lib/security/counterStore";

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

/** Firestore collection holding one counter document per UTC day, id `YYYY-MM-DD`. */
export const AI_CALL_BUDGET_COLLECTION = "aiCallBudget";

/** How long a spent day's counter is kept before a TTL policy may delete it. Long enough to audit a bill against. */
const BUDGET_DOC_RETENTION_DAYS = 35;

export interface DailyCallBudgetOptions {
  /** Defaults to `configuredDailyCallBudget()`, read at reserve time. */
  readonly maxCallsPerDay?: () => number;
  /** Injectable for tests; defaults to `Date`. */
  readonly now?: () => Date;
  /** Optional, operator-supplied, reporting only — never part of the decision. */
  readonly estimatedCostPerCall?: number;
  /**
   * Where the count lives. Defaults to a process-local store, which is right
   * for a test and wrong for Vercel; the resolution path passes the
   * Firestore store.
   */
  readonly store?: CounterStore;
}

export interface BudgetUsage {
  readonly day: string;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  /** `used × estimatedCostPerCall`, or null when no price was configured. */
  readonly estimatedCost: number | null;
}

export type BudgetReservation = { ok: true; usage: BudgetUsage } | { ok: false; error: ProviderError };

export interface DailyCallBudget {
  /**
   * Takes one call's worth of budget, or refuses. Incrementing before the
   * call rather than after — atomically, in the store — is what makes two
   * concurrent callers, on the same instance or on two, unable to both take
   * the last unit.
   */
  reserve(): Promise<BudgetReservation>;
  /** Gives a reservation back when the call turned out not to happen. */
  release(): Promise<void>;
  usage(): Promise<BudgetUsage>;
}

export function createDailyCallBudget(options: DailyCallBudgetOptions = {}): DailyCallBudget {
  const now = options.now ?? (() => new Date());
  const limitOf = options.maxCallsPerDay ?? (() => configuredDailyCallBudget());
  const store = options.store ?? createMemoryCounterStore();

  // The day is re-derived on every call rather than tracked, so the reset at
  // midnight UTC is a new document id, not a branch that could be missed.
  function slotFor(at: Date, limit: number): CounterSlot {
    return {
      collection: AI_CALL_BUDGET_COLLECTION,
      docId: utcDayKey(at),
      limit,
      expireAt: new Date(at.getTime() + BUDGET_DOC_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  function snapshot(day: string, used: number, limit: number): BudgetUsage {
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
    async reserve() {
      const at = now();
      const day = utcDayKey(at);
      const limit = limitOf();
      // Checked before the store, so a budget of zero refuses even when the
      // store is unreachable, and costs no round trip.
      if (limit <= 0) return { ok: false, error: ProviderErrors.budgetExhausted(limit, day) };

      let outcome;
      try {
        outcome = await store.reserve(slotFor(at, limit));
      } catch (cause) {
        return { ok: false, error: ProviderErrors.budgetUnavailable(cause) };
      }
      if (!outcome.admitted) return { ok: false, error: ProviderErrors.budgetExhausted(limit, day) };
      return { ok: true, usage: snapshot(day, outcome.count, limit) };
    },
    async release() {
      const at = now();
      await store.release(slotFor(at, limitOf()));
    },
    async usage() {
      const at = now();
      const limit = limitOf();
      const slot = slotFor(at, limit);
      return snapshot(slot.docId, await store.read(slot), limit);
    },
  };
}
