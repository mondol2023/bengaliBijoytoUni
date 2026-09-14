/**
 * The single server-side source of truth for "what tier applies to this
 * request" — the fix for the gap `/api/documents/extract` has carried since
 * Phase 3: a client-supplied tier value is never trusted. An anonymous
 * caller (or any caller while Firebase isn't configured yet) gets the
 * default tier; a signed-in caller gets whatever tier is on their own
 * `users/{uid}` profile document, which only they (or, later, an admin
 * override) can set — never something asserted per-request.
 */
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { userProfileSchema, usageOverrideSchema } from "@/lib/firebase/schemas";
import { getSystemConfig } from "@/lib/firebase/systemConfig";
import { DEFAULT_TIER } from "@/features/usage/tierConfig";
import type { TierId } from "@/types/domain";

export async function resolveServerTier(uid: string | null): Promise<TierId> {
  if (!uid || !isFirebaseAdminConfigured) return DEFAULT_TIER;

  try {
    const snapshot = await getAdminDb().collection("users").doc(uid).get();
    if (!snapshot.exists) return DEFAULT_TIER;
    const parsed = userProfileSchema.safeParse(snapshot.data());
    return parsed.success ? parsed.data.tier : DEFAULT_TIER;
  } catch {
    return DEFAULT_TIER;
  }
}

export interface ServerLimits {
  tier: TierId;
  /** Layered over the tier's own limit — a per-user override wins over an admin's tier-wide override. */
  overrideMaxChars?: number;
}

/**
 * The full server-side answer to "what usage limit applies to this caller",
 * combining the caller's own tier with any admin-configured override —
 * either a site-wide override for that tier (`systemConfig/limits`) or a
 * per-user override (`usageOverrides/{uid}`, set from `/api/admin/users`).
 * Never trusts anything from the request itself.
 */
export async function resolveServerLimits(uid: string | null): Promise<ServerLimits> {
  const tier = await resolveServerTier(uid);
  if (!uid || !isFirebaseAdminConfigured) return { tier };

  try {
    const [userOverrideSnapshot, systemConfig] = await Promise.all([
      getAdminDb().collection("usageOverrides").doc(uid).get(),
      getSystemConfig(),
    ]);

    if (userOverrideSnapshot.exists) {
      const parsed = usageOverrideSchema.safeParse(userOverrideSnapshot.data());
      if (parsed.success) return { tier, overrideMaxChars: parsed.data.maxNonWhitespaceChars };
    }

    const tierOverride = systemConfig.tierOverrides[tier];
    if (tierOverride) return { tier, overrideMaxChars: tierOverride.maxNonWhitespaceChars };

    return { tier };
  } catch {
    return { tier };
  }
}
