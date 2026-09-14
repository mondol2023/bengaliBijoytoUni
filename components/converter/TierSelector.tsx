"use client";

import { Badge } from "@/components/ui/Badge";
import { Select, type SelectOption } from "@/components/ui/Select";
import { TIERS } from "@/features/usage/tierConfig";
import type { TierId } from "@/types/domain";

/**
 * `locked` shows the caller's server-known account tier as a fixed badge
 * instead of a free picker — used wherever the server ignores the
 * client-supplied tier and always resolves it from the signed-in account
 * (currently `/api/documents/extract`; see `resolveServerTier`). `caption`
 * lets the caller explain *why* it's locked (e.g. "signed in" vs. "anonymous
 * uploads are capped at Easy").
 */
export function TierSelector({
  tier,
  onChange,
  locked = false,
  caption,
}: {
  tier: TierId;
  onChange: (tier: TierId) => void;
  locked?: boolean;
  caption?: string;
}) {
  const options: SelectOption[] = Object.values(TIERS).map((t) => ({
    value: t.id,
    label: `${t.label} · up to ${t.maxNonWhitespaceChars.toLocaleString()} chars`,
  }));

  if (locked) {
    const current = TIERS[tier];
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground/70">Tier</span>
        <Badge tone="accent">{current.label}</Badge>
        {caption && <span className="text-xs text-foreground/50">{caption}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="tier-select" className="text-sm font-medium text-foreground/70">
        Tier
      </label>
      <Select
        value={tier}
        onValueChange={(value) => onChange(value as TierId)}
        options={options}
        ariaLabel="Usage tier"
        className="min-w-56"
      />
      {caption && <span className="text-xs text-foreground/50">{caption}</span>}
    </div>
  );
}
