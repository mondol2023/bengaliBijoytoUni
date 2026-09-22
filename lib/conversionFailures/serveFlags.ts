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

export function isServeUnverifiedAiEnabled(): boolean {
  const raw = process.env[SERVE_UNVERIFIED_AI_ENV];
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
