/**
 * The explicit, off-by-default switch for outbound AI provider calls.
 *
 * Having API keys present is not consent to spend them. Before this flag, the
 * only thing standing between a deployment and a paid outbound call was
 * whether `GEMINI_API_KEY`/`OPENAI_API_KEY` happened to be set — so copying a
 * production `.env` into a staging box, or filling in a key to test one
 * unrelated thing, silently armed the whole resolution path. The flag
 * separates "this deployment *can* call a provider" from "this deployment
 * *may*", and the second answer is no unless someone wrote it down.
 *
 * Default-deny is load-bearing: an unset, empty, misspelled, or
 * partially-written value all mean disabled. Only the exact strings below
 * enable it, so a typo fails closed rather than into a billable call.
 *
 * Read at call time, not at module load, so a test can flip it with
 * `vi.stubEnv` without resetting the module graph, and so a platform that
 * injects env vars after import order still sees the right value.
 */
export const AI_RESOLUTION_ENABLED_ENV = "AI_RESOLUTION_ENABLED";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isAiResolutionEnabled(): boolean {
  const raw = process.env[AI_RESOLUTION_ENABLED_ENV];
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
