/**
 * Provider-agnostic domain types for the AI conversion-resolution pipeline.
 * Nothing here knows about Firestore, HTTP, or a specific provider's SDK —
 * see `docs/conversion-failure-pipeline.md` §7 for the full flow. The engine
 * (`features/converter/engine/*`) never imports from `lib/ai/*`, and nothing
 * in `lib/ai/*` imports the engine beyond its version string as plain data.
 */

/**
 * Providers with a real, ToS-compliant API and an adapter under
 * `lib/ai/providers/`. `search_ai` (Google/ChatGPT "search" web UIs) is
 * deliberately excluded — no official API exists, and this project does not
 * build browser-automation/scraping integrations. See
 * `docs/conversion-failure-pipeline.md` §7 for that decision.
 */
export const SUPPORTED_PROVIDER_IDS = ["gemini", "openai"] as const;
export type ProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (SUPPORTED_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * What a provider is asked to resolve. Firestore-independent by design: a
 * caller builds this from a `ConversionFailure`/`FailurePattern` document (or
 * from anything else), never the reverse. `null` — not `undefined` — for
 * "known absent," matching the rest of the codebase's Firestore convention
 * even though this type itself is never persisted as-is.
 */
export interface ConversionResolutionRequest {
  /** Traceability only — the provider adapter never fetches or writes Firestore. */
  readonly failureId?: string;
  readonly failurePatternId?: string;

  readonly encodingId: string | null;
  readonly failedSequence: string;
  readonly codePoints: number[];

  /** Bounded context around the failure. Never the full document unless `ResolutionOptions.includeContext`. */
  readonly contextBefore?: string;
  readonly contextAfter?: string;
  /** Only attached to the prompt when `ResolutionOptions.includeFullText` is explicitly set. */
  readonly fullText?: string;
  readonly position?: number | null;

  readonly currentEngineOutput?: string | null;
  readonly failureCategory?: string;

  /** What produced the failure — makes a resolution auditable against the exact deterministic rules it critiques. */
  readonly engineVersion: string;
  readonly rulesHash: string | null;
}

export type ResolutionConfidence = "low" | "medium" | "high";

/**
 * Normalized, provider-independent result. This is what an adapter returns
 * after parsing/validating a provider's raw structured output
 * (`responseSchema.ts`) — never the raw provider JSON itself.
 */
export interface ConversionResolution {
  /**
   * `null` when the provider indicates it has no useful candidate — a real,
   * meaningful outcome, never coerced into a guess. See `isCertain` below.
   */
  readonly candidateConversion: string | null;
  readonly alternatives: string[];
  /** `null` when the provider gave no assessable confidence (distinct from a request's `rulesHash: null`). */
  readonly confidence: ResolutionConfidence | null;
  /** True only when the provider explicitly signals certainty about `candidateConversion`. */
  readonly isCertain: boolean;
  /** Short, user-safe rationale. Never the provider's hidden chain-of-thought — see prompt builder + response schema. */
  readonly explanation: string | null;

  readonly provider: ProviderId;
  readonly model: string;
  readonly promptVersion: string;
  readonly engineVersion: string;
  readonly rulesHash: string | null;
}

/**
 * Caller-controlled privacy knobs. Defaults (see `registry.ts`/each adapter)
 * are the *minimum* information a provider needs — a caller must opt in to
 * sending more, never the other way around.
 */
export interface ResolutionOptions {
  readonly includeFullText?: boolean;
  readonly includeContext?: boolean;
  readonly timeoutMs?: number;
}

export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: import("./errors").ProviderError };

export function providerOk<T>(value: T): ProviderResult<T> {
  return { ok: true, value };
}

export function providerErr<T>(error: import("./errors").ProviderError): ProviderResult<T> {
  return { ok: false, error };
}

/**
 * Implemented once per provider under `lib/ai/providers/`. `isConfigured`
 * lets the registry and callers check readiness without triggering a network
 * call or throwing; `resolve` is the only method that talks to the network.
 */
export interface ConversionResolutionProvider {
  readonly id: ProviderId;
  /** The exact configured model id (e.g. `"gemini-2.0-flash"`) — a caller can read this without triggering a network call, e.g. to key a dedup/cache lookup before calling `resolve`. */
  readonly model: string;
  isConfigured(): boolean;
  resolve(
    request: ConversionResolutionRequest,
    options?: ResolutionOptions,
  ): Promise<ProviderResult<ConversionResolution>>;
}
