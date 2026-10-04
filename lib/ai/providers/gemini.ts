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
  DocumentTranscription,
  DocumentTranscriptionProvider,
  DocumentTranscriptionRequest,
  ProviderResult,
  ResolutionOptions,
} from "../types";
import { providerOk, providerErr } from "../types";
import { ProviderErrors, providerErrorForHttpStatus, unreadableResponseDebug } from "../errors";
import { buildResolutionPrompt } from "../promptBuilder";
import { parseProviderResponseText } from "../responseSchema";
import { RESOLUTION_LIMITS, TRANSCRIPTION_LIMITS } from "../limits";
import { TRANSCRIPTION_PROMPT_VERSION, TRANSCRIPTION_SYSTEM_INSTRUCTION } from "../transcriptionPrompt";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
/**
 * Transcription reads a whole judgment and writes it back out, which needs a
 * far larger output budget than a one-cluster resolution — hence its own
 * model, overridable without a deploy of new code when Google renames one.
 */
const GEMINI_TRANSCRIPTION_MODEL = process.env.GEMINI_TRANSCRIPTION_MODEL?.trim() || "gemini-2.5-flash";

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

interface GeminiText {
  text: string;
  finishReason: string | null;
}

async function callGemini(
  systemInstruction: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<ProviderResult<string>> {
  const result = await generateContent(
    GEMINI_MODEL,
    {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    },
    timeoutMs,
  );
  return result.ok ? providerOk(result.value.text) : result;
}

async function generateContent(
  model: string,
  requestBody: unknown,
  timeoutMs: number,
): Promise<ProviderResult<GeminiText>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return providerErr(providerErrorForHttpStatus("gemini", response.status, { body: await safeText(response) }));
    }

    const body = (await response.json()) as unknown;
    const candidate = (
      body as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: unknown }[] }
    )?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
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
    const finishReason = typeof candidate?.finishReason === "string" ? candidate.finishReason : null;
    return providerOk({ text, finishReason });
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

async function transcribe(
  request: DocumentTranscriptionRequest,
  options: { readonly timeoutMs?: number } = {},
): Promise<ProviderResult<DocumentTranscription>> {
  if (!isGeminiConfigured()) {
    return providerErr(ProviderErrors.notConfigured("gemini"));
  }

  const parts: unknown[] = [];
  if (request.file) {
    parts.push({ inlineData: { mimeType: request.file.mimeType, data: request.file.data.toString("base64") } });
    parts.push({ text: "Transcribe this document." });
  } else {
    parts.push({ text: `Transcribe this document. Its extracted text follows.

${request.text ?? ""}` });
  }

  const result = await generateContent(
    GEMINI_TRANSCRIPTION_MODEL,
    {
      systemInstruction: { parts: [{ text: TRANSCRIPTION_SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "text/plain",
        temperature: 0,
        maxOutputTokens: TRANSCRIPTION_LIMITS.maxOutputTokens,
      },
    },
    options.timeoutMs ?? TRANSCRIPTION_LIMITS.timeoutMs,
  );
  if (!result.ok) return result;

  const text = result.value.text.trim();
  if (text.length === 0) {
    return providerErr(ProviderErrors.invalidResponse("gemini", { reason: "empty transcription" }));
  }
  return providerOk({
    text,
    truncated: result.value.finishReason === "MAX_TOKENS",
    provider: "gemini",
    model: GEMINI_TRANSCRIPTION_MODEL,
    promptVersion: TRANSCRIPTION_PROMPT_VERSION,
  });
}

export const geminiTranscriptionProvider: DocumentTranscriptionProvider = {
  id: "gemini",
  model: GEMINI_TRANSCRIPTION_MODEL,
  isConfigured: isGeminiConfigured,
  transcribe,
};
