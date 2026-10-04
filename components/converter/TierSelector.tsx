"use client";

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="plate-marker">Limit</span>
        <span className="font-mono text-sm tabular-nums">
          {current.label} · {current.maxNonWhitespaceChars.toLocaleString()} chars
        </span>
        {caption && <span className="text-xs text-foreground/60">{caption}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="plate-marker">Limit</span>
      <Select
        value={tier}
        onValueChange={(value) => onChange(value as TierId)}
        options={options}
        ariaLabel="Usage tier"
        className="min-w-56"
      />
      {caption && <span className="text-xs text-foreground/60">{caption}</span>}
    </div>
  );
}
