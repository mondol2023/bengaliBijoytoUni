/**
 * Server-only writers for the three activity collections
 * (`conversions`/`comparisons`/`documents`) plus the rolling `usage/{uid}`
 * counters. Each function validates its record with the matching zod schema
 * before writing and throws a plain `Error` on any failure — it does *not*
 * decide whether that failure should be surfaced to the caller. A route
 * saving on the user's explicit request (the "Save to history" actions) lets
 * it propagate to its normal `fail()` handling; a route where this is a
 * best-effort side effect of a primary feature (document extraction) wraps
 * the call in its own try/catch instead. See call sites.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, getAdminStorage } from "./admin";
import {
  comparisonRecordSchema,
  conversionRecordSchema,
  documentRecordSchema,
  type ComparisonRecord,
  type ConversionRecord,
  type DocumentRecord,
} from "./schemas";
import { recordComparisonStats, recordConversionStats, recordDocumentStats } from "./adminStats";
import { logAppError } from "@/lib/errors/handlers";
import { FORMAT_MIME } from "@/features/documents/config";
import type { InputType, SupportedFileFormat, TierId } from "@/types/domain";

/**
 * Bumps the site-wide admin counters as a best-effort side effect of an
 * activity write. Deliberately never lets a stats-counter failure fail the
 * activity write itself — see `adminStats.ts`'s module doc.
 */
async function safeBumpAdminStats(action: () => Promise<void>, context: Record<string, unknown>): Promise<void> {
  try {
    await action();
  } catch (cause) {
    logAppError(
      { code: "DATABASE_ERROR", message: "Failed to update admin stats counters.", debug: cause },
      context,
    );
  }
}

interface UsageDelta {
  totalConversions?: number;
  totalComparisons?: number;
  totalDocuments?: number;
  totalCharsProcessed?: number;
}

async function bumpUsage(userId: string, delta: UsageDelta) {
  await getAdminDb()
    .collection("usage")
    .doc(userId)
    .set(
      {
        userId,
        totalConversions: FieldValue.increment(delta.totalConversions ?? 0),
        totalComparisons: FieldValue.increment(delta.totalComparisons ?? 0),
        totalDocuments: FieldValue.increment(delta.totalDocuments ?? 0),
        totalCharsProcessed: FieldValue.increment(delta.totalCharsProcessed ?? 0),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
}

export interface RecordConversionInput {
  userId: string;
  tier: TierId;
  encodingId: string;
  inputType: InputType;
  charCount: number;
  wordCount: number;
  fileFormat: SupportedFileFormat | null;
  durationMs: number;
  status: "success" | "error";
  error: string | null;
}

export async function recordConversion(input: RecordConversionInput): Promise<string> {
  const record: ConversionRecord = { ...input, createdAt: new Date().toISOString() };
  const validated = conversionRecordSchema.parse(record);
  const ref = getAdminDb().collection("conversions").doc();
  await ref.set(validated);
  await bumpUsage(input.userId, { totalConversions: 1, totalCharsProcessed: input.charCount });
  await safeBumpAdminStats(() => recordConversionStats(input.encodingId, input.status, input.charCount), {
    route: "recordConversion",
  });
  return ref.id;
}

export interface RecordComparisonInput {
  userId: string;
  mode: "word" | "paragraph";
  similarity: number;
  sourceWordCount: number;
  targetWordCount: number;
  changedWordCount: number;
}

export async function recordComparison(input: RecordComparisonInput): Promise<string> {
  const record: ComparisonRecord = { ...input, createdAt: new Date().toISOString() };
  const validated = comparisonRecordSchema.parse(record);
  const ref = getAdminDb().collection("comparisons").doc();
  await ref.set(validated);
  await bumpUsage(input.userId, { totalComparisons: 1 });
  await safeBumpAdminStats(() => recordComparisonStats(input.mode), { route: "recordComparison" });
  return ref.id;
}

export interface RecordDocumentUploadInput {
  userId: string;
  buffer: Buffer;
  fileName: string;
  fileType: SupportedFileFormat;
  extractionStatus: "success" | "error";
}

/** Uploads the original file to Storage at `users/{uid}/documents/{docId}/{filename}`, then records its metadata. */
export async function recordDocumentUpload(input: RecordDocumentUploadInput): Promise<string> {
  const docId = getAdminDb().collection("documents").doc().id;
  const storagePath = `users/${input.userId}/documents/${docId}/${input.fileName}`;

  await getAdminStorage()
    .bucket()
    .file(storagePath)
    .save(input.buffer, { contentType: FORMAT_MIME[input.fileType] });

  const record: DocumentRecord = {
    userId: input.userId,
    storagePath,
    fileName: input.fileName,
    fileType: input.fileType,
    sizeBytes: input.buffer.byteLength,
    extractionStatus: input.extractionStatus,
    createdAt: new Date().toISOString(),
  };
  const validated = documentRecordSchema.parse(record);
  await getAdminDb().collection("documents").doc(docId).set(validated);
  await bumpUsage(input.userId, { totalDocuments: 1 });
  await safeBumpAdminStats(() => recordDocumentStats(input.fileType, input.extractionStatus), {
    route: "recordDocumentUpload",
  });
  return docId;
}
