/**
 * The only place that maps a `ProviderId` to a `ConversionResolutionProvider`
 * implementation. Callers (a future resolution service/API route — not built
 * in this phase) ask for a provider by id here; they never import
 * `providers/*.ts` directly. Unknown ids produce a controlled
 * `provider_not_registered` error — there is no silent fallback to a default
 * provider.
 */
import { assertServerOnly } from "./assertServerOnly";

assertServerOnly("lib/ai/registry.ts");

import { type ConversionResolutionProvider, type ProviderId, isProviderId } from "./types";
import { type ProviderResult, providerOk, providerErr } from "./types";
import { ProviderErrors } from "./errors";
import { geminiProvider } from "./providers/gemini";
import { openAiProvider } from "./providers/openai";

const PROVIDERS: Record<ProviderId, ConversionResolutionProvider> = {
  gemini: geminiProvider,
  openai: openAiProvider,
};

/** Every registered provider, regardless of whether it's currently configured. */
export function listResolutionProviders(): ConversionResolutionProvider[] {
  return Object.values(PROVIDERS);
}

/**
 * Looks up a provider by id. Returns `provider_not_registered` for an id
 * that isn't a real `ProviderId` at all (e.g. `"search_ai"`, a typo, or a
 * future id nobody built an adapter for yet) — distinct from
 * `provider_not_configured`, which `provider.resolve()` itself returns for a
 * real provider missing its API key.
 */
export function getResolutionProvider(id: string): ProviderResult<ConversionResolutionProvider> {
  if (!isProviderId(id)) {
    return providerErr(ProviderErrors.notRegistered(id));
  }
  return providerOk(PROVIDERS[id]);
}
