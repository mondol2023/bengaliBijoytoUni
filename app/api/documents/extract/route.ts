import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AUTO_DETECT } from "@/features/converter/constants";
import { getEncoding } from "@/features/converter/encodings/registry";
import {
  convertDocument,
  detectEncoding,
  formatUnmappedDetails,
} from "@/features/converter/engine/pipeline";
import { extractDocumentText } from "@/features/documents/extract";
import { rejectOversizeFile, rejectOversizeRequest } from "@/features/documents/uploadGuard";
import { validateUsage } from "@/features/usage/usageService";
import { failResponder, logAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";
import { getServerUser } from "@/lib/auth/session";
import { resolveServerLimits } from "@/lib/auth/tier";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { captureServerIssue } from "@/lib/firebase/errorLog";
import { captureConversionFailures } from "@/lib/firebase/conversionFailures";
import { buildFailureOccurrence } from "@/lib/conversionFailures/occurrence";
import type { ErrorLog } from "@/lib/firebase/schemas";
import { recordConversion, recordDocumentUpload } from "@/lib/firebase/recordActivity";
import { getSystemConfigSafe } from "@/lib/firebase/systemConfig";
import { checkRateLimit, getRequestIp } from "@/lib/security/rateLimit";
import { countWords } from "@/lib/utils/text";

export const runtime = "nodejs";

// Reachable without sign-in and does real PDF/DOCX/DOC parsing per call, so it
// gets its own (generous but bounded) window rather than relying solely on
// per-file size caps. See `lib/security/rateLimit.ts` for the caveats of an
// in-memory, per-instance limiter.
const RATE_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };

const fail = failResponder("api/documents/extract");

/**
 * Records a document failure in the persisted error log. Unlike the
 * client-side pipeline, nothing in this route reaches the browser's log when
 * the request fails early — an unreadable PDF produces a response and no
 * conversion outcome to derive an issue from — so the capture happens here,
 * on the server, where the failure actually is.
 *
 * Awaited rather than fired-and-forgotten because serverless can freeze the
 * instance the moment the response is returned. It never throws, and it only
 * runs on paths that are already failing, so it costs nothing on the happy
 * path.
 */
async function capture(
  input: Pick<ErrorLog, "kind" | "severity" | "code" | "message"> & {
    userId: string | null;
    encodingId?: string | null;
    fileName?: string | null;
    fileType?: string | null;
    samples?: string[];
  },
): Promise<void> {
  if (!isFirebaseAdminConfigured) return;
  await captureServerIssue({
    userId: input.userId,
    source: "file",
    kind: input.kind,
    severity: input.severity,
    code: input.code,
    message: input.message,
    encodingId: input.encodingId ?? null,
    fileName: input.fileName ?? null,
    fileType: input.fileType ?? null,
    samples: input.samples ?? [],
    route: "api/documents/extract",
  });
}

/**
 * Extracts text from an uploaded document and converts it through the exact
 * same pipeline manual text input uses (`convertDocument`), so there is one
 * conversion code path regardless of input source.
 *
 * Tier is never read from the request body. An anonymous caller gets the
 * default tier; a signed-in caller (identified by a verified `Authorization`
 * bearer ID token) gets whatever tier is on their own `users/{uid}` profile
 * — this closes the gap this route carried since Phase 3, where a
 * client-supplied `tier` field was trusted as-is.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  const user = await getServerUser(request);
  const rateLimitKey = `extract:${user ? `uid:${user.uid}` : `ip:${getRequestIp(request)}`}`;
  const rateLimit = checkRateLimit({ key: rateLimitKey, ...RATE_LIMIT });
  if (!rateLimit.ok) return fail(rateLimit.error);

  // Before `formData()`, which is what actually buffers the body.
  const systemConfig = await getSystemConfigSafe();
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

  if (systemConfig.featureFlags?.documentsEnabled === false) {
    return fail(AppErrors.authorization("Document uploads are currently disabled by an administrator."));
  }

  const { tier, overrideMaxChars } = await resolveServerLimits(user?.uid ?? null);

  const encodingValue = formData.get("encodingId");
  const encodingChoice = typeof encodingValue === "string" && encodingValue.length > 0 ? encodingValue : AUTO_DETECT;

  const buffer = Buffer.from(await file.arrayBuffer());

  const extraction = await extractDocumentText(buffer, file.name, file.type, systemConfig.maxUploadSizeBytes);
  if (!extraction.ok) {
    await capture({
      userId: user?.uid ?? null,
      kind: "file_extraction_failed",
      severity: "error",
      code: extraction.error.code,
      message: extraction.error.message,
      fileName: file.name,
      fileType: file.type || null,
    });
    return fail(extraction.error);
  }
  const { text, fileType, pageCount, notes } = extraction.value;

  const usageResult = validateUsage(text, tier, overrideMaxChars);
  if (!usageResult.ok) {
    await capture({
      userId: user?.uid ?? null,
      kind: "limit_exceeded",
      severity: "error",
      code: usageResult.error.code,
      message: usageResult.error.message,
      fileName: file.name,
      fileType,
    });
    return fail(usageResult.error);
  }

  const detection = detectEncoding(text);
  const resolvedEncodingId = encodingChoice === AUTO_DETECT ? detection.encodingId : encodingChoice;

  if (!resolvedEncodingId || !getEncoding(resolvedEncodingId)) {
    const error = AppErrors.validation("Could not determine a source encoding for this document.", {
      details: { field: "encodingId" },
    });
    await capture({
      userId: user?.uid ?? null,
      kind: "conversion_failed",
      severity: "error",
      code: error.code,
      message: error.message,
      fileName: file.name,
      fileType,
    });
    return fail(error);
  }

  if (systemConfig.enabledEncodings && !systemConfig.enabledEncodings.includes(resolvedEncodingId)) {
    return fail(
      AppErrors.validation("This encoding has been disabled by an administrator.", {
        details: { field: "encodingId" },
      }),
    );
  }

  const conversion = convertDocument({
    extractedText: text,
    encodingId: resolvedEncodingId,
    fileName: file.name,
  });
  if (!conversion.ok) {
    await capture({
      userId: user?.uid ?? null,
      kind: "conversion_failed",
      severity: "error",
      code: conversion.error.code,
      message: conversion.error.message,
      encodingId: resolvedEncodingId,
      fileName: file.name,
      fileType,
    });
    return fail(conversion.error);
  }

  // A converted-but-imperfect document is the failure mode worth collecting
  // most: it returns 200, the user sees Bengali, and only the unmapped
  // sequences reveal that a mapping rule is missing. Logged on the success
  // path for exactly that reason.
  const { validation } = conversion.value;
  if (validation.unmappedSequences.length > 0) {
    await capture({
      userId: user?.uid ?? null,
      kind: "unmapped_character",
      severity: "warning",
      code: "UNMAPPED_CHARACTER",
      message: [
        `${validation.unmappedSequences.length} legacy character sequence(s) had no mapping rule and were passed through unchanged.`,
        // Where each one sat in the converted text. `samples` below stays the
        // bare byte list, so this is the only place the stored row records
        // enough for someone to identify the missing rule later.
        formatUnmappedDetails(validation.unmappedDetails, 4),
      ]
        .filter(Boolean)
        .join("\n"),
      encodingId: conversion.value.encodingId,
      fileName: file.name,
      fileType,
      samples: validation.unmappedSequences,
    });

    // The deeper, admin-only dataset (docs/conversion-failure-pipeline.md).
    // `text` is read only to slice each failed sequence's context window
    // (`buildFailureOccurrence` enforces that bound); the extracted document
    // itself is never persisted here.
    // Awaited like every other write on this path, for the same
    // serverless-freeze reason `capture()`'s doc comment explains.
    const sessionId = randomUUID();
    await captureConversionFailures(
      validation.unmappedDetails.map((detail) => ({
        ...buildFailureOccurrence(
          {
            source: "file",
            encodingId: conversion.value.encodingId,
            engineVersion: conversion.value.engineVersion,
            rulesHash: conversion.value.rulesHash,
            fileName: file.name,
            fileType,
          },
          conversion.value.sourceText,
          detail,
        ),
        userId: user?.uid ?? null,
        sessionId,
        route: "api/documents/extract",
      })),
      "api/documents/extract",
    );
  }

  // Persistence is a side effect of this feature, not the feature itself —
  // a signed-in user's document was still successfully converted even if
  // Storage/Firestore is unreachable, so failures here are logged and
  // swallowed rather than turned into a failed response.
  if (user) {
    try {
      await recordDocumentUpload({
        userId: user.uid,
        buffer,
        fileName: file.name,
        fileType,
        extractionStatus: "success",
      });
      await recordConversion({
        userId: user.uid,
        tier,
        encodingId: conversion.value.encodingId,
        inputType: "file",
        charCount: usageResult.usage.used,
        wordCount: countWords(text),
        fileFormat: fileType,
        durationMs: Date.now() - startedAt,
        status: "success",
        error: null,
      });
    } catch (cause) {
      logAppError(
        { code: "DATABASE_ERROR", message: "Failed to record document conversion history.", debug: cause },
        { route: "api/documents/extract", userId: user.uid },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    fileName: file.name,
    fileType,
    pageCount: pageCount ?? null,
    notes: notes ?? null,
    encodingId: conversion.value.encodingId,
    detectionConfidence: detection.confidence,
    unicodeText: conversion.value.unicodeText,
    validation: conversion.value.validation,
    usage: usageResult.usage,
  });
}

export function GET() {
  return fail(AppErrors.validation("Use POST with multipart/form-data."));
}
