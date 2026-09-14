import { describe, expect, it } from "vitest";
import {
  adminStatsTotalsSchema,
  auditLogSchema,
  errorLogSchema,
  feedbackSchema,
  comparisonRecordSchema,
  conversionRecordSchema,
  documentRecordSchema,
  parseFirestoreDoc,
  systemConfigSchema,
  usageOverrideSchema,
  userProfileSchema,
} from "./schemas";

describe("parseFirestoreDoc", () => {
  it("accepts a well-formed user profile", () => {
    const result = parseFirestoreDoc(userProfileSchema, {
      uid: "abc123",
      email: "person@example.com",
      displayName: "Person",
      tier: "medium",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a profile with an unknown tier", () => {
    const result = parseFirestoreDoc(userProfileSchema, {
      uid: "abc123",
      email: null,
      displayName: null,
      tier: "premium",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.startsWith("tier"))).toBe(true);
  });

  it("rejects a profile missing required fields", () => {
    const result = parseFirestoreDoc(userProfileSchema, { uid: "abc123" });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed conversion record", () => {
    const result = parseFirestoreDoc(conversionRecordSchema, {
      userId: "abc123",
      tier: "easy",
      encodingId: "bijoy",
      inputType: "text",
      charCount: 120,
      wordCount: 20,
      fileFormat: null,
      durationMs: 4,
      status: "success",
      error: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a conversion record with a negative count", () => {
    const result = parseFirestoreDoc(conversionRecordSchema, {
      userId: "abc123",
      tier: "easy",
      encodingId: "bijoy",
      inputType: "text",
      charCount: -1,
      wordCount: 20,
      fileFormat: null,
      durationMs: 4,
      status: "success",
      error: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed comparison record", () => {
    const result = parseFirestoreDoc(comparisonRecordSchema, {
      userId: "abc123",
      mode: "word",
      similarity: 0.87,
      sourceWordCount: 40,
      targetWordCount: 42,
      changedWordCount: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a comparison record with an out-of-range similarity", () => {
    const result = parseFirestoreDoc(comparisonRecordSchema, {
      userId: "abc123",
      mode: "word",
      similarity: 1.5,
      sourceWordCount: 40,
      targetWordCount: 42,
      changedWordCount: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed document record", () => {
    const result = parseFirestoreDoc(documentRecordSchema, {
      userId: "abc123",
      storagePath: "users/abc123/documents/doc1/file.pdf",
      fileName: "file.pdf",
      fileType: "pdf",
      sizeBytes: 2048,
      extractionStatus: "success",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a document record with an unsupported file type", () => {
    const result = parseFirestoreDoc(documentRecordSchema, {
      userId: "abc123",
      storagePath: "users/abc123/documents/doc1/file.rtf",
      fileName: "file.rtf",
      fileType: "rtf",
      sizeBytes: 2048,
      extractionStatus: "success",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed audit log entry", () => {
    const result = parseFirestoreDoc(auditLogSchema, {
      actorUid: "admin-uid",
      action: "user.tier.set",
      target: "users/abc123",
      metadata: { oldTier: "easy", newTier: "medium" },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an audit log entry missing an action", () => {
    const result = parseFirestoreDoc(auditLogSchema, {
      actorUid: "admin-uid",
      target: "users/abc123",
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed usage override", () => {
    const result = parseFirestoreDoc(usageOverrideSchema, {
      uid: "abc123",
      maxNonWhitespaceChars: 50000,
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "admin-uid",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a usage override with a non-positive limit", () => {
    const result = parseFirestoreDoc(usageOverrideSchema, {
      uid: "abc123",
      maxNonWhitespaceChars: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "admin-uid",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a system config with no overrides set", () => {
    const result = parseFirestoreDoc(systemConfigSchema, {
      tierOverrides: {},
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a system config with tier overrides, encodings, and feature flags", () => {
    const result = parseFirestoreDoc(systemConfigSchema, {
      tierOverrides: { medium: { maxNonWhitespaceChars: 10000 } },
      enabledEncodings: ["bijoy"],
      maxUploadSizeBytes: 5 * 1024 * 1024,
      featureFlags: { documentsEnabled: true, comparisonEnabled: false },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a system config with a non-positive tier override limit", () => {
    const result = parseFirestoreDoc(systemConfigSchema, {
      tierOverrides: { easy: { maxNonWhitespaceChars: -1 } },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed admin stats totals document", () => {
    const result = parseFirestoreDoc(adminStatsTotalsSchema, {
      totalUsers: 3,
      totalConversions: 10,
      totalComparisons: 2,
      totalDocuments: 4,
      totalCharsProcessed: 12000,
      conversionsByStatus: { success: 9, error: 1 },
      documentsByStatus: { success: 4, error: 0 },
      comparisonsByMode: { word: 2, paragraph: 0 },
      documentsByFormat: { pdf: 2, docx: 1, doc: 0, txt: 1 },
      conversionsByEncoding: { bijoy: 7, sutonny: 3 },
      usersByTier: { easy: 2, medium: 1, expert: 0 },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an admin stats totals document with a negative counter", () => {
    const result = parseFirestoreDoc(adminStatsTotalsSchema, {
      totalUsers: -1,
      totalConversions: 10,
      totalComparisons: 2,
      totalDocuments: 4,
      totalCharsProcessed: 12000,
      conversionsByStatus: { success: 9, error: 1 },
      documentsByStatus: { success: 4, error: 0 },
      comparisonsByMode: { word: 2, paragraph: 0 },
      documentsByFormat: { pdf: 2, docx: 1, doc: 0, txt: 1 },
      conversionsByEncoding: {},
      usersByTier: { easy: 2, medium: 1, expert: 0 },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });
});

describe("errorLogSchema", () => {
  const VALID = {
    userId: null,
    source: "text",
    kind: "unmapped_character",
    severity: "warning",
    code: "UNMAPPED_CHARACTER",
    message: "2 sequences had no mapping rule.",
    encodingId: "bijoy",
    fileName: null,
    fileType: null,
    samples: ["Av", "ÿ"],
    occurrences: 1,
    route: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts an anonymous browser-reported failure", () => {
    expect(parseFirestoreDoc(errorLogSchema, VALID).ok).toBe(true);
  });

  it("accepts a server-captured file failure", () => {
    const result = parseFirestoreDoc(errorLogSchema, {
      ...VALID,
      userId: "abc123",
      source: "file",
      kind: "file_extraction_failed",
      severity: "error",
      code: "FILE_PROCESSING_ERROR",
      fileName: "report.pdf",
      fileType: "pdf",
      samples: [],
      route: "api/documents/extract",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown failure kind", () => {
    const result = parseFirestoreDoc(errorLogSchema, { ...VALID, kind: "exploded" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.startsWith("kind"))).toBe(true);
  });

  it("rejects a severity outside error/warning", () => {
    expect(parseFirestoreDoc(errorLogSchema, { ...VALID, severity: "info" }).ok).toBe(false);
  });

  it("rejects a non-positive occurrence count", () => {
    expect(parseFirestoreDoc(errorLogSchema, { ...VALID, occurrences: 0 }).ok).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(parseFirestoreDoc(errorLogSchema, { ...VALID, message: "" }).ok).toBe(false);
  });

  it("requires userId to be present, even when null", () => {
    const withoutUserId: Record<string, unknown> = { ...VALID };
    delete withoutUserId.userId;
    expect(parseFirestoreDoc(errorLogSchema, withoutUserId).ok).toBe(false);
  });
});

describe("feedbackSchema", () => {
  const VALID = {
    userId: null,
    email: "person@example.com",
    category: "wrong_conversion",
    rating: 3,
    message: "The conjunct in my second paragraph came out wrong.",
    page: "/converter",
    encodingId: "bijoy",
    sampleInput: "Avwg",
    sampleOutput: "আমি",
    status: "new",
    adminNote: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts an anonymous complaint with conversion context", () => {
    expect(parseFirestoreDoc(feedbackSchema, VALID).ok).toBe(true);
  });

  it("accepts a triaged entry with an admin note", () => {
    const result = parseFirestoreDoc(feedbackSchema, {
      ...VALID,
      userId: "abc123",
      status: "resolved",
      adminNote: "Mapping rule added for the conjunct.",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a rating-free submission", () => {
    expect(parseFirestoreDoc(feedbackSchema, { ...VALID, rating: null }).ok).toBe(true);
  });

  it("rejects a rating outside 1-5", () => {
    expect(parseFirestoreDoc(feedbackSchema, { ...VALID, rating: 6 }).ok).toBe(false);
    expect(parseFirestoreDoc(feedbackSchema, { ...VALID, rating: 0 }).ok).toBe(false);
  });

  it("rejects an empty message", () => {
    const result = parseFirestoreDoc(feedbackSchema, { ...VALID, message: "   " });
    expect(result.ok).toBe(true); // whitespace is trimmed by the route, not the schema
    expect(parseFirestoreDoc(feedbackSchema, { ...VALID, message: "" }).ok).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(parseFirestoreDoc(feedbackSchema, { ...VALID, category: "rant" }).ok).toBe(false);
  });

  it("rejects an unknown triage status", () => {
    expect(parseFirestoreDoc(feedbackSchema, { ...VALID, status: "archived" }).ok).toBe(false);
  });
});
