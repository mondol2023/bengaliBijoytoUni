import { NextResponse, type NextRequest } from "next/server";
import { rejectOversizeRequest } from "@/features/documents/uploadGuard";
import { isOcrAiAvailable, readOcrImages } from "@/lib/ai/ocrImages";
import type { OcrImageInput } from "@/lib/ai/types";
import { requireServerUser } from "@/lib/auth/session";
import { failResponder } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";
import { OCR_AI_LIMITS } from "@/lib/ocr/limits";
import { checkSharedRateLimit } from "@/lib/security/sharedRateLimit";

export const runtime = "nodejs";
/** Up to two providers at `OCR_AI_LIMITS.providerTimeoutMs` each, plus the budget writes. */
export const maxDuration = 60;

const fail = failResponder("api/ocr/improve");

const IMAGE_FIELD = /^image-(\d+)$/;

/** The kind comes from the bytes: a client-supplied `type` is only a claim. */
function sniffMimeType(bytes: Uint8Array): OcrImageInput["mimeType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  return null;
}

/**
 * Re-reads cropped lines the in-browser OCR was unsure about, with an AI
 * vision provider (`lib/ai/ocrImages.ts` walks the provider chain).
 *
 * Signed-in callers only: this spends the deployment's money, and an anonymous
 * caller has the local reading. Only the cropped images arrive here — never
 * the document — and nothing is stored: the crops and the readings live for
 * this request. Kept out of `app/api/documents` on purpose, like
 * `/api/ai/transcribe`: that tree is the deterministic conversion path and
 * must never reach `lib/ai` (`lib/ai/__tests__/callSites.test.ts`).
 *
 * Fields are `image-0` … `image-<n-1>`; the response lists one text per image,
 * in that order.
 */
export async function POST(request: NextRequest) {
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);

  const rateLimit = await checkSharedRateLimit({
    key: `ocr-improve:uid:${auth.value.uid}`,
    shared: true,
    ...OCR_AI_LIMITS.rateLimit,
  });
  if (!rateLimit.ok) return fail(rateLimit.error);

  const oversizeRequest = rejectOversizeRequest(request, OCR_AI_LIMITS.maxRequestBytes);
  if (oversizeRequest) return fail(oversizeRequest);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail(AppErrors.validation("Expected multipart/form-data with image fields."));
  }

  const slots: (File | null)[] = new Array(OCR_AI_LIMITS.maxImagesPerRequest).fill(null);
  for (const [name, value] of formData.entries()) {
    const match = IMAGE_FIELD.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    if (index >= OCR_AI_LIMITS.maxImagesPerRequest || !(value instanceof File)) {
      return fail(AppErrors.validation(`Send up to ${OCR_AI_LIMITS.maxImagesPerRequest} image files.`));
    }
    slots[index] = value;
  }
  // Fields must be contiguous from image-0, so a response position always means the same image.
  const gap = slots.indexOf(null);
  const count = gap === -1 ? slots.length : gap;
  if (count === 0 || slots.slice(count).some((slot) => slot !== null)) {
    return fail(AppErrors.validation(`Send between 1 and ${OCR_AI_LIMITS.maxImagesPerRequest} images, numbered from image-0.`));
  }
  const files = slots.slice(0, count) as File[];

  const images: OcrImageInput[] = [];
  for (const file of files) {
    if (file.size > OCR_AI_LIMITS.maxImageBytes) {
      return fail(AppErrors.validation("An image is too large to send for AI reading."));
    }
    const data = Buffer.from(await file.arrayBuffer());
    const mimeType = sniffMimeType(data);
    if (!mimeType) return fail(AppErrors.validation("Only JPEG or PNG images can be sent."));
    images.push({ mimeType, data });
  }

  const result = await readOcrImages(images);
  if (!result.ok) return fail(result.error);

  return NextResponse.json({
    ok: true,
    texts: result.value.texts,
    provider: result.value.provider,
    model: result.value.model,
  });
}

/** Whether AI reading is offered here at all; spends no call and no budget. */
export async function GET(request: NextRequest) {
  const auth = await requireServerUser(request);
  if (!auth.ok) return fail(auth.error);
  return NextResponse.json({ ok: true, available: await isOcrAiAvailable() });
}
