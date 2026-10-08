/**
 * A daily ceiling on OCR provider calls, one counter per provider.
 *
 * Same rules as `lib/ai/costCap.ts` and deliberately a separate counter: a
 * burst of OCR reads must not starve conversion-failure resolution or
 * transcription, and the reverse. It counts calls, not money, and it fails
 * closed — a zero or unparseable budget, a spent day and an unreachable
 * counter all refuse. `costCap.ts` itself is untouched; this reuses its
 * pure helpers and the same `CounterStore` the shared rate limiter uses.
 *
 * The store is injected. `lib/ai/ocrImages.ts` supplies the Firestore one, so
 * a count holds across Vercel instances; tests supply the in-memory one.
 */
import { configuredDailyCallBudget, utcDayKey, type BudgetReservation, type BudgetUsage } from "@/lib/ai/costCap";
import { ProviderErrors } from "@/lib/ai/errors";
import type { ProviderId } from "@/lib/ai/types";
import { createMemoryCounterStore, type CounterSlot, type CounterStore } from "@/lib/security/counterStore";

/** One document per provider per UTC day, id `<provider>-YYYY-MM-DD`. Give the collection a TTL policy on `expireAt` from the console (`docs/data-retention.md`). */
export const OCR_CALL_BUDGET_COLLECTION = "ocrCallBudget";

/** Long enough to audit a bill against, as in `costCap.ts`. */
const BUDGET_DOC_RETENTION_DAYS = 35;

export function ocrBudgetEnvName(provider: ProviderId): string {
  return `OCR_${provider.toUpperCase()}_DAILY_CALL_BUDGET`;
}

export interface OcrCallBudgetOptions {
  readonly provider: ProviderId;
  /** Defaults to a process-local store, which is right for a test and wrong for Vercel. */
  readonly store?: CounterStore;
  /** Defaults to the provider's env var, read at reserve time. */
  readonly maxCallsPerDay?: () => number;
  readonly now?: () => Date;
}

export interface OcrCallBudget {
  /** Takes one call's worth of budget atomically, or refuses. */
  reserve(): Promise<BudgetReservation>;
  /** Gives a reservation back when the call turned out not to happen. */
  release(): Promise<void>;
  usage(): Promise<BudgetUsage>;
}

export function createOcrCallBudget(options: OcrCallBudgetOptions): OcrCallBudget {
  const { provider } = options;
  const now = options.now ?? (() => new Date());
  // `?? ""`, not the bare value: `configuredDailyCallBudget(undefined)` falls
  // back to ITS default parameter, `AI_DAILY_CALL_BUDGET`, which would let the
  // resolution budget variable govern OCR. An empty string means "unset".
  const limitOf =
    options.maxCallsPerDay ??
    (() => configuredDailyCallBudget(process.env[ocrBudgetEnvName(provider)] ?? ""));
  const store = options.store ?? createMemoryCounterStore();

  function slotFor(at: Date, limit: number): CounterSlot {
    return {
      collection: OCR_CALL_BUDGET_COLLECTION,
      docId: `${provider}-${utcDayKey(at)}`,
      limit,
      expireAt: new Date(at.getTime() + BUDGET_DOC_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  function snapshot(day: string, used: number, limit: number): BudgetUsage {
    return { day, used, limit, remaining: Math.max(0, limit - used), estimatedCost: null };
  }

  return {
    async reserve() {
      const at = now();
      const day = utcDayKey(at);
      const limit = limitOf();
      // Before the store, so a budget of zero refuses even when the store is down.
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
      return snapshot(utcDayKey(at), await store.read(slotFor(at, limit)), limit);
    },
  };
}
