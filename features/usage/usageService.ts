import { countNonWhitespaceChars } from "@/lib/utils/text";
import { AppErrors, LimitExceededError } from "@/lib/errors/types";
import type { TierId } from "@/types/domain";
import { getTierLimit } from "./tierConfig";

export interface UsageCheck {
  tier: TierId;
  used: number;
  max: number;
  remaining: number;
  withinLimit: boolean;
}

/**
 * The single enforcement point for tier limits. Called from the client for
 * immediate feedback, and again from the server route handler (with the
 * user's *server-known* tier/override — never a client-supplied value) as
 * the source of truth. Never truncates input; only reports whether it fits.
 */
export function checkUsage(text: string, tier: TierId, overrideMaxChars?: number): UsageCheck {
  const used = countNonWhitespaceChars(text);
  const max = getTierLimit(tier, overrideMaxChars);
  return {
    tier,
    used,
    max,
    remaining: Math.max(0, max - used),
    withinLimit: used <= max,
  };
}

/** Same as `checkUsage`, but returns a typed error result instead of a boolean. */
export function validateUsage(
  text: string,
  tier: TierId,
  overrideMaxChars?: number,
): { ok: true; usage: UsageCheck } | { ok: false; error: LimitExceededError; usage: UsageCheck } {
  const usage = checkUsage(text, tier, overrideMaxChars);
  if (usage.withinLimit) return { ok: true, usage };
  return {
    ok: false,
    usage,
    error: AppErrors.limitExceeded(
      `This input has ${usage.used.toLocaleString()} characters, which exceeds the ${usage.tier} tier limit of ${usage.max.toLocaleString()}. Reduce the input or use a higher tier.`,
      { details: { tier: usage.tier, used: usage.used, max: usage.max } },
    ),
  };
}
