import { describe, expect, it } from "vitest";
import { resolveServerLimits, resolveServerTier } from "./tier";
import { DEFAULT_TIER } from "@/features/usage/tierConfig";

/**
 * No Firebase admin credentials are set in the test environment, so
 * `isFirebaseAdminConfigured` is false — these tests exercise exactly the
 * fallback path every deployment runs before `docs/firebase-setup.md` is
 * followed, and the anonymous-caller path that always applies.
 */
describe("resolveServerTier", () => {
  it("returns the default tier for an anonymous caller", async () => {
    await expect(resolveServerTier(null)).resolves.toBe(DEFAULT_TIER);
  });

  it("returns the default tier for any uid while Firebase admin isn't configured", async () => {
    await expect(resolveServerTier("some-uid")).resolves.toBe(DEFAULT_TIER);
  });
});

describe("resolveServerLimits", () => {
  it("returns the default tier with no override for an anonymous caller", async () => {
    await expect(resolveServerLimits(null)).resolves.toEqual({ tier: DEFAULT_TIER });
  });

  it("returns the default tier with no override for any uid while Firebase admin isn't configured", async () => {
    await expect(resolveServerLimits("some-uid")).resolves.toEqual({ tier: DEFAULT_TIER });
  });
});
