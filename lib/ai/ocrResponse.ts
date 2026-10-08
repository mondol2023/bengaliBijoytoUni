import { z } from "zod";
import { OCR_AI_LIMITS } from "@/lib/ocr/limits";
import { ProviderErrors } from "./errors";
import { type ProviderId, type ProviderResult, providerErr, providerOk } from "./types";

const responseSchema = z.object({
  images: z.array(z.object({ index: z.number().int(), text: z.string() })),
});

/**
 * Validates a provider's raw answer to an OCR request and returns one text per
 * image, in image order. All-or-nothing: a count mismatch, a repeated or
 * out-of-range `index`, an empty or over-long text, or anything that is not
 * exactly the JSON object asked for fails the whole call — pairing a text
 * with the wrong crop would put one line's words under another line's image.
 *
 * The failure's `debug` carries only the reason, never the model's text,
 * which `logAppError` would otherwise print.
 */
export function parseOcrResponse(
  provider: ProviderId,
  raw: string,
  expectedCount: number,
): ProviderResult<string[]> {
  const invalid = (reason: string) => providerErr<string[]>(ProviderErrors.invalidResponse(provider, { reason }));

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid("not JSON");
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return invalid("unexpected shape");

  const { images } = parsed.data;
  if (images.length !== expectedCount) return invalid("wrong number of entries");

  const texts: string[] = new Array(expectedCount);
  for (const { index, text } of images) {
    if (index < 1 || index > expectedCount) return invalid("index out of range");
    if (texts[index - 1] !== undefined) return invalid("duplicate index");
    const trimmed = text.trim();
    if (trimmed.length === 0) return invalid("empty text");
    if (trimmed.length > OCR_AI_LIMITS.maxTextChars) return invalid("text too long");
    texts[index - 1] = trimmed;
  }
  return providerOk(texts);
}
