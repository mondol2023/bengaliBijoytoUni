/**
 * The switch that decides whether unreviewed AI output may reach a user.
 *
 * Same shape and the same default-deny reasoning as
 * `lib/ai/enabled.ts` — unset, empty, misspelled or half-written all mean
 * off, and only the exact strings below turn it on, so a typo fails closed
 * rather than into publishing text nobody read. It is a separate module
 * rather than a second export there because the serving path must not import
 * `lib/ai` at all (`lib/ai/__tests__/callSites.test.ts`).
 *
 * Off, the published snapshot carries only resolutions a human accepted. On,
 * it may also carry ones that merely passed the validator, and every one of
 * those is labelled in the payload itself — see `AI_UNVERIFIED_LABEL` — so
 * the label cannot be lost by a component that forgets to add it.
 *
 * Read at call time, not at module load, for the same two reasons as the
 * flag it mirrors: `vi.stubEnv` in a test, and platforms that inject
 * environment variables after import order.
 */
export const SERVE_UNVERIFIED_AI_ENV = "SERVE_UNVERIFIED_AI";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** The one parsing rule both flags share: only the exact words above, trimmed, any case. */
function isTruthy(raw: string | undefined): boolean {
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Note for the browser: this reads `process.env` by a computed key, which
 * Next.js does not inline into a client bundle, so in a browser it is
 * always off. That fails closed — `runConversion` refuses unverified entries
 * client-side — and it means turning this flag on does not, by itself, make
 * a `fallback_unverified` segment render in the converter.
 */
export function isServeUnverifiedAiEnabled(): boolean {
  return isTruthy(process.env[SERVE_UNVERIFIED_AI_ENV]);
}

/**
 * The rollout switch for the fallback pipeline in the converter UI: whether
 * `hooks/useConversion.ts` fetches the snapshot and runs `runConversion`,
 * rather than calling `convertLegacyText` directly as it did before Phase 6.
 * Off, the converter behaves exactly as it did before; on, accepted
 * fallbacks render. Separate from `SERVE_UNVERIFIED_AI`, which still alone
 * decides whether an unreviewed entry may be served.
 *
 * Same default-deny parsing as the flag above. Two differences, both forced
 * by where it is read:
 *
 * - **`NEXT_PUBLIC_`**, because the hook runs in the browser and only
 *   `NEXT_PUBLIC_*` values reach a client bundle.
 * - **Read as the literal `process.env.NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE`**,
 *   never by a computed key: Next.js inlines only the literal spelling, so a
 *   computed read would be permanently off in the browser.
 *   `__tests__/serveFlags.test.ts` pins the spelling in this file's source.
 *
 * The consequence for rollback: in a browser the value is fixed when the
 * app is built, so turning it off is "unset the variable and rebuild" — no
 * code revert, but not instantaneous either. In Node (tests, the server) it
 * is read per call.
 */
export const ENABLE_FALLBACK_PIPELINE_ENV = "NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE";

export function isFallbackPipelineEnabled(): boolean {
  return isTruthy(process.env.NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE);
}
