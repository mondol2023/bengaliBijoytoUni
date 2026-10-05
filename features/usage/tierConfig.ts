import type { TierId } from "@/types/domain";

export interface TierDefinition {
  id: TierId;
  label: string;
  /** Maximum allowed non-whitespace characters per conversion request. */
  maxNonWhitespaceChars: number;
}

/**
 * Single source of truth for tier limits. Nothing outside this file (and
 * `usageService`, which reads it) should hard-code a character limit.
 * Admin-configured overrides live in Firestore `systemConfig` (Phase 6+) and
 * are layered on top of these defaults server-side — they never replace this
 * file, so there is always a safe fallback.
 */
export const TIERS: Record<TierId, TierDefinition> = {
  easy: { id: "easy", label: "Easy", maxNonWhitespaceChars: 3000 },
  medium: { id: "medium", label: "Medium", maxNonWhitespaceChars: 8000 },
  pro: { id: "pro", label: "Pro", maxNonWhitespaceChars: 20000 },
  expert: { id: "expert", label: "Expert", maxNonWhitespaceChars: 50000 },
  ultra: { id: "ultra", label: "Ultra", maxNonWhitespaceChars: 75000 },
};

export const DEFAULT_TIER: TierId = "easy";

export function getTierLimit(tier: TierId, overrideMaxChars?: number): number {
  return overrideMaxChars ?? TIERS[tier].maxNonWhitespaceChars;
}

export function listTiers(): TierDefinition[] {
  return Object.values(TIERS);
}
