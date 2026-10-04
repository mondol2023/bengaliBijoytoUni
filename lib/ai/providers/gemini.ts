/**
 * Google Gemini adapter — a plain `fetch` call against the Generative
 * Language REST API, no SDK dependency (matching the rest of the codebase's
 * preference for minimal dependencies). `GEMINI_API_KEY` is read once at
 * module scope, exactly like `lib/firebase/admin.ts` reads its credentials,
 * and never crosses into the returned `ConversionResolution`/`ProviderError`.
 */
import { assertServerOnly } from "../assertServerOnly";

assertServerOnly("lib/ai/providers/gemini.ts");

import type {
  ConversionResolution,
  ConversionResolutionProvider,
  ConversionResolutionRequest,
  ProviderResult,
  ResolutionOptions,
} from "../types";
import { providerOk, providerErr } from "../types";
import { ProviderErrors, providerErrorForHttpStatus, unreadableResponseDebug } from "../errors";
import { buildResolutionPrompt } from "../promptBuilder";
import { parseProviderResponseText } from "../responseSchema";
import { RESOLUTION_LIMITS } from "../limits";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export function isGeminiConfigured(): boolean {
  return Boolean(GEMINI_API_KEY);
}

async function safeText(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function callGemini(
  systemInstruction: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<ProviderResult<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return providerErr(providerErrorForHttpStatus("gemini", response.status, { body: await safeText(response) }));
    }

    const body = (await response.json()) as unknown;
    const text = (body as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]
      ?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      const shape = body as { candidates?: { finishReason?: unknown }[]; promptFeedback?: { blockReason?: unknown } };
      return providerErr(
        ProviderErrors.invalidResponse(
          "gemini",
          unreadableResponseDebug("no text in Gemini response", body, {
            finishReason: shape?.candidates?.[0]?.finishReason,
            blockReason: shape?.promptFeedback?.blockReason,
          }),
        ),
      );
    }
    return providerOk(text);
  } catch (cause) {
    if (controller.signal.aborted) {
      return providerErr(ProviderErrors.timeout("gemini", cause));
    }
    return providerErr(ProviderErrors.unavailable("gemini", cause));
  } finally {
    clearTimeout(timer);
  }
}

async function resolve(
  request: ConversionResolutionRequest,
  options: ResolutionOptions = {},
): Promise<ProviderResult<ConversionResolution>> {
  if (!isGeminiConfigured()) {
    return providerErr(ProviderErrors.notConfigured("gemini"));
  }

  const prompt = buildResolutionPrompt(request, options);
  const timeoutMs = options.timeoutMs ?? RESOLUTION_LIMITS.defaultTimeoutMs;

  const textResult = await callGemini(prompt.systemInstruction, prompt.userPrompt, timeoutMs);
  if (!textResult.ok) return textResult;

  const parsed = parseProviderResponseText("gemini", textResult.value);
  if (!parsed.ok) return parsed;

  return providerOk({
    candidateConversion: parsed.value.candidateConversion,
    alternatives: parsed.value.alternatives,
    confidence: parsed.value.confidence,
    isCertain: parsed.value.isCertain,
    explanation: parsed.value.explanation,
    provider: "gemini",
    model: GEMINI_MODEL,
    promptVersion: prompt.promptVersion,
    engineVersion: request.engineVersion,
    rulesHash: request.rulesHash,
  });
}

export const geminiProvider: ConversionResolutionProvider = {
  id: "gemini",
  model: GEMINI_MODEL,
  isConfigured: isGeminiConfigured,
  resolve,
};
