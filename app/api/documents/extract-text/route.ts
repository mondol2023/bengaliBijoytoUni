import { NextResponse, type NextRequest } from "next/server";
import { extractDocumentText } from "@/features/documents/extract";
import { rejectOversizeFile, rejectOversizeRequest } from "@/features/documents/uploadGuard";
import { getServerUser } from "@/lib/auth/session";
import { getSystemConfigSafe } from "@/lib/firebase/systemConfig";
import { checkRateLimit, getRequestIp } from "@/lib/security/rateLimit";
import { failResponder } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

// Reachable without sign-in and does real PDF/DOCX/DOC parsing per call, so it
// gets its own (generous but bounded) window rather than relying solely on
// per-file size caps. See `lib/security/rateLimit.ts` for the caveats of an
// in-memory, per-instance limiter.
const RATE_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };

const fail = failResponder("api/documents/extract-text");

/**
 * Extraction-only sibling of `/api/documents/extract` — returns raw
 * extracted text without running it through the Bijoy/SutonnyMJ conversion
 * pipeline. The comparison tool diffs whatever text it's given, legacy-
 * encoded or already Unicode, so forcing a conversion (and the encoding
 * detection/tier gating that comes with it) here would be the wrong shape
 * for that call site.
 */
export async function POST(request: NextRequest) {
  const systemConfig = await getSystemConfigSafe();
  if (systemConfig.featureFlags?.comparisonEnabled === false) {
    return fail(AppErrors.authorization("Document comparison is currently disabled by an administrator."));
  }

  const user = await getServerUser(request);
  const rateLimitKey = `extract-text:${user ? `uid:${user.uid}` : `ip:${getRequestIp(request)}`}`;
  const rateLimit = checkRateLimit({ key: rateLimitKey, ...RATE_LIMIT });
  if (!rateLimit.ok) return fail(rateLimit.error);

  // Before `formData()`, which is what actually buffers the body.
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
  // Passes the admin-configured cap through, like `/api/documents/extract`
  // already did — this route was falling back to the hard-coded default and
  // ignoring `systemConfig.maxUploadSizeBytes` entirely.
  const extraction = await extractDocumentText(buffer, file.name, file.type, systemConfig.maxUploadSizeBytes);
  if (!extraction.ok) return fail(extraction.error);

  const { text, fileType, pageCount, notes } = extraction.value;
  return NextResponse.json({
    ok: true,
    text,
    fileName: file.name,
    fileType,
    pageCount: pageCount ?? null,
    notes: notes ?? null,
  });
}

export function GET() {
  return fail(AppErrors.validation("Use POST with multipart/form-data."));
}
