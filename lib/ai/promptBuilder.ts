/**
 * The single place that turns a `ConversionResolutionRequest` into text sent
 * to an AI provider. Provider adapters (`providers/*.ts`) call this — they
 * never construct prompt text themselves — so the framing, the privacy
 * defaults, and the versioning all live in one auditable spot.
 *
 * `CONVERSION_RESOLUTION_PROMPT_VERSION` is stamped onto every
 * `ConversionResolution` (`types.ts`). Bump it whenever the wording below
 * changes in a way that could shift model behavior — it's part of what makes
 * a stored resolution reproducible/auditable later.
 */
import type { ConversionResolutionRequest, ResolutionOptions } from "./types";
import { RESOLUTION_LIMITS } from "./limits";

export const CONVERSION_RESOLUTION_PROMPT_VERSION = "v1";

export interface ResolutionPrompt {
  readonly promptVersion: string;
  readonly systemInstruction: string;
  readonly userPrompt: string;
}

/**
 * Deliberately narrow and repeated (title + body) — a model that drifts
 * toward "translate this" or "fix the spelling" produces output that is
 * actively wrong for this domain, not just unhelpful.
 */
const TASK_FRAMING = `You are assisting a legacy-encoding-to-Unicode text conversion pipeline. Your job is ONLY to analyze one short sequence of characters that a deterministic conversion engine could NOT map to Unicode, and to propose what Unicode text that sequence most likely represents in its original (legacy, font-encoded) script.

This is NOT translation. This is NOT summarization or rewriting. This is NOT spelling or grammar correction. Do not translate the text into another language, do not paraphrase, and do not "improve" surrounding correct text. If the sequence does not look like a legacy-encoded fragment of a real script, or you cannot determine a likely mapping, say so — do not invent one.

Respond with ONLY a single JSON object, no prose outside it, matching this shape:
{
  "candidateConversion": string | null,
  "alternatives": string[],
  "confidence": "low" | "medium" | "high" | null,
  "isCertain": boolean,
  "explanation": string | null
}

Rules:
- "candidateConversion" is the best-guess Unicode text for the failed sequence, or null if you cannot determine one — never guess just to fill the field.
- "alternatives" holds other plausible Unicode readings (can be empty).
- "isCertain" is true only if you are confident "candidateConversion" is correct; otherwise false, even if you provided a candidate.
- "explanation" is at most a few sentences, safe to show a human reviewer directly. Do not include step-by-step reasoning, chain-of-thought, or any internal deliberation — a short justification only.
- Output nothing before or after the JSON object.`;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function formatCodePoints(codePoints: number[]): string {
  return codePoints.map((point) => `U+${point.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}

/**
 * Builds the versioned prompt for one resolution request. `options` controls
 * how much surrounding text is embedded — the default (all flags unset) is
 * the minimum: the failed sequence and its code points only, no context, no
 * full text. A caller must explicitly opt in to more.
 */
export function buildResolutionPrompt(
  request: ConversionResolutionRequest,
  options: ResolutionOptions = {},
): ResolutionPrompt {
  const lines: string[] = [];

  lines.push(`Encoding: ${request.encodingId ?? "unknown"}`);
  lines.push(`Failed sequence: ${JSON.stringify(request.failedSequence)}`);
  lines.push(`Code points: ${formatCodePoints(request.codePoints)}`);

  if (request.currentEngineOutput != null) {
    lines.push(`Deterministic engine's current output for this sequence: ${JSON.stringify(request.currentEngineOutput)}`);
  }
  if (request.failureCategory) {
    lines.push(`Failure category: ${request.failureCategory}`);
  }

  if (options.includeContext) {
    if (request.contextBefore) {
      lines.push(`Context before: ${JSON.stringify(truncate(request.contextBefore, RESOLUTION_LIMITS.maxPromptContextLength))}`);
    }
    if (request.contextAfter) {
      lines.push(`Context after: ${JSON.stringify(truncate(request.contextAfter, RESOLUTION_LIMITS.maxPromptContextLength))}`);
    }
  }

  if (options.includeFullText && request.fullText) {
    lines.push(
      `Full source text (for broader context only — analyze the failed sequence above, not this whole passage): ${JSON.stringify(
        truncate(request.fullText, RESOLUTION_LIMITS.maxPromptFullTextLength),
      )}`,
    );
  }

  return {
    promptVersion: CONVERSION_RESOLUTION_PROMPT_VERSION,
    systemInstruction: TASK_FRAMING,
    userPrompt: lines.join("\n"),
  };
}
