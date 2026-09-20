/**
 * Parses and validates a provider's raw structured-output text. This is the
 * only place a provider's JSON is trusted — a provider adapter must route
 * every response through here before it can become a `ConversionResolution`.
 * Anything that doesn't parse or doesn't match the shape becomes a
 * `provider_invalid_response` `ProviderError`; nothing malformed ever reaches
 * a caller or Firestore.
 */
import { z } from "zod";
import type { ProviderId } from "./types";
import { type ProviderResult, providerOk, providerErr } from "./types";
import { ProviderErrors } from "./errors";
import { RESOLUTION_LIMITS } from "./limits";

const rawProviderResponseSchema = z.object({
  candidateConversion: z.string().min(1).max(RESOLUTION_LIMITS.maxCandidateLength).nullable(),
  alternatives: z
    .array(z.string().min(1).max(RESOLUTION_LIMITS.maxCandidateLength))
    .max(RESOLUTION_LIMITS.maxAlternatives)
    .default([]),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  isCertain: z.boolean(),
  explanation: z.string().max(RESOLUTION_LIMITS.maxExplanationLength).nullable().default(null),
});

export type RawProviderResolution = z.infer<typeof rawProviderResponseSchema>;

/** Providers commonly wrap JSON output in a ```json fence despite instructions not to — tolerate it rather than reject good data. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parses provider output text end to end: fence-stripping, JSON parsing,
 * shape/bounds validation. Never throws — every failure mode becomes a
 * normalized `ProviderError` via the `ProviderResult` union.
 */
export function parseProviderResponseText(
  provider: ProviderId,
  text: string,
): ProviderResult<RawProviderResolution> {
  const candidate = stripCodeFence(text);
  if (candidate.length === 0) {
    return providerErr(ProviderErrors.invalidResponse(provider, { reason: "empty response body" }));
  }

  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (cause) {
    return providerErr(ProviderErrors.invalidResponse(provider, { reason: "response is not valid JSON", cause }));
  }

  const parsed = rawProviderResponseSchema.safeParse(json);
  if (!parsed.success) {
    return providerErr(ProviderErrors.invalidResponse(provider, { reason: "response failed schema validation", issues: parsed.error.issues }));
  }

  return providerOk(parsed.data);
}
