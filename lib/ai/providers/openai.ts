/**
 * OpenAI adapter — a plain `fetch` call against the Chat Completions REST
 * API with JSON-mode output, no SDK dependency. See `gemini.ts` for the
 * shared shape both adapters follow; kept separate rather than factored into
 * a shared "REST provider" base because each provider's request/response
 * envelope and auth header differ enough that a shared abstraction would
 * mostly be indirection.
 */
import { assertServerOnly } from "../assertServerOnly";

assertServerOnly("lib/ai/providers/openai.ts");

import type {
  ConversionResolution,
  ConversionResolutionProvider,
  ConversionResolutionRequest,
  ProviderResult,
  ResolutionOptions,
} from "../types";
import { providerOk, providerErr } from "../types";
import { ProviderErrors, providerErrorForHttpStatus } from "../errors";
import { buildResolutionPrompt } from "../promptBuilder";
import { parseProviderResponseText } from "../responseSchema";
import { RESOLUTION_LIMITS } from "../limits";

const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export function isOpenAiConfigured(): boolean {
  return Boolean(OPENAI_API_KEY);
}

async function safeText(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function callOpenAi(
  systemInstruction: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<ProviderResult<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return providerErr(providerErrorForHttpStatus("openai", response.status, { body: await safeText(response) }));
    }

    const body = (await response.json()) as unknown;
    const text = (body as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      return providerErr(ProviderErrors.invalidResponse("openai", { reason: "no content in OpenAI response", body }));
    }
    return providerOk(text);
  } catch (cause) {
    if (controller.signal.aborted) {
      return providerErr(ProviderErrors.timeout("openai", cause));
    }
    return providerErr(ProviderErrors.unavailable("openai", cause));
  } finally {
    clearTimeout(timer);
  }
}

async function resolve(
  request: ConversionResolutionRequest,
  options: ResolutionOptions = {},
): Promise<ProviderResult<ConversionResolution>> {
  if (!isOpenAiConfigured()) {
    return providerErr(ProviderErrors.notConfigured("openai"));
  }

  const prompt = buildResolutionPrompt(request, options);
  const timeoutMs = options.timeoutMs ?? RESOLUTION_LIMITS.defaultTimeoutMs;

  const textResult = await callOpenAi(prompt.systemInstruction, prompt.userPrompt, timeoutMs);
  if (!textResult.ok) return textResult;

  const parsed = parseProviderResponseText("openai", textResult.value);
  if (!parsed.ok) return parsed;

  return providerOk({
    candidateConversion: parsed.value.candidateConversion,
    alternatives: parsed.value.alternatives,
    confidence: parsed.value.confidence,
    isCertain: parsed.value.isCertain,
    explanation: parsed.value.explanation,
    provider: "openai",
    model: OPENAI_MODEL,
    promptVersion: prompt.promptVersion,
    engineVersion: request.engineVersion,
    rulesHash: request.rulesHash,
  });
}

export const openAiProvider: ConversionResolutionProvider = {
  id: "openai",
  model: OPENAI_MODEL,
  isConfigured: isOpenAiConfigured,
  resolve,
};
