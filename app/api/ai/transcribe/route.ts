import { NextResponse, type NextRequest } from "next/server";
import { resolveFileFormat } from "@/features/documents/config";
import { extractDocumentText } from "@/features/documents/extract";
import { rejectOversizeFile, rejectOversizeRequest } from "@/features/documents/uploadGuard";
import { validateUsage } from "@/features/usage/usageService";
import { TRANSCRIPTION_LIMITS } from "@/lib/ai/limits";
import { transcribeDocument } from "@/lib/ai/transcribeDocument";
import { getServerUser } from "@/lib/auth/session";
import { resolveServerLimits } from "@/lib/auth/tier";
import { failResponder } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";
import { getSystemConfigSafe } from "@/lib/firebase/systemConfig";
import { checkSharedRateLimit, rateLimitIdentity } from "@/lib/security/sharedRateLimit";

export const runtime = "nodejs";
/** A long judgment takes Gemini well over a minute to write out. */
export const maxDuration = 120;

const fail = failResponder("api/ai/transcribe");

/**
 * Transcribes an uploaded document with Gemini — the fallback the document
 * page calls when the engine's own result scores below
 * `AI_FALLBACK_THRESHOLD` (`features/documents/quality.ts`), and the target
 * of its "Convert with Gemini" button.
 *
 * Kept apart from `/api/documents/extract` deliberately: that route is the
 * deterministic conversion path, which must never reach `lib/ai`
 * (`lib/ai/__tests__/callSites.test.ts`). The client asks for this second
 * opinion; the engine never does.
 *
 * A PDF goes to the provider as the file itself, so pages that draw their
 * text as images are read too. Other formats go as their extracted text,
 * bounded by the caller's tier like any conversion. Nothing is stored: the
 * file and the transcription live only for this request.
 */
export async function POST(request: NextRequest) {
  const user = await getServerUser(request);
  const caller = rateLimitIdentity(request, user);
  const rateLimit = await checkSharedRateLimit({
    key: `ai-transcribe:${caller.id}`,
    shared: caller.shared,
    ...TRANSCRIPTION_LIMITS.rateLimit,
  });
  if (!rateLimit.ok) return fail(rateLimit.error);

  const systemConfig = await getSystemConfigSafe();
  if (systemConfig.featureFlags?.documentsEnabled === false) {
    return fail(AppErrors.authorization("Document uploads are currently disabled by an administrator."));
  }
  const oversizeRequest = rejectOversizeRequest(request, systemConfig.maxUploadSizeBytes);
  if (oversizeRequest) return fail(oversizeRequest);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail(AppErrors.validation("Expected multipart/form-data with a file field."));
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return fail(AppErrors.validation('Missing "file" field.', { details: { field: "file" } }));
  }
  const oversizeFile = rejectOversizeFile(file, systemConfig.maxUploadSizeBytes);
  if (oversizeFile) return fail(oversizeFile);

  const buffer = Buffer.from(await file.arrayBuffer());
  const format = resolveFileFormat(file.name, file.type);

  let transcription;
  if (format === "pdf") {
    transcription = await transcribeDocument({
      file: { mimeType: "application/pdf", data: buffer },
      fileName: file.name,
    });
  } else {
    const extraction = await extractDocumentText(buffer, file.name, file.type, systemConfig.maxUploadSizeBytes);
    if (!extraction.ok) return fail(extraction.error);
    const { tier, overrideMaxChars } = await resolveServerLimits(user?.uid ?? null);
    const usage = validateUsage(extraction.value.text, tier, overrideMaxChars);
    if (!usage.ok) return fail(usage.error);
    transcription = await transcribeDocument({ text: extraction.value.text, fileName: file.name });
  }
  if (!transcription.ok) return fail(transcription.error);

  return NextResponse.json({
    ok: true,
    text: transcription.value.text,
    truncated: transcription.value.truncated,
    provider: transcription.value.provider,
    model: transcription.value.model,
  });
}

export function GET() {
  return fail(AppErrors.validation("Use POST with multipart/form-data."));
}
