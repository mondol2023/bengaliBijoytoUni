import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Guards the reporting half of the privacy bound: whatever a caller puts on
 * the wire, no whole-document field may reach `recordConversionFailures`.
 * The builder half is covered in `lib/conversionFailures/limits.test.ts`.
 */
vi.mock("@/lib/firebase/admin", () => ({
  isFirebaseAdminConfigured: true,
}));

vi.mock("@/lib/firebase/conversionFailures", () => ({
  recordConversionFailures: vi.fn().mockResolvedValue(["occurrence-1"]),
}));

vi.mock("@/lib/auth/session", () => ({
  getServerUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/security/sharedRateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/sharedRateLimit")>();
  return { ...actual, checkSharedRateLimit: vi.fn(async () => ({ ok: true })) };
});

import { recordConversionFailures } from "@/lib/firebase/conversionFailures";
import { CONVERSION_FAILURE_LIMITS } from "@/lib/conversionFailures/limits";
import { POST } from "./route";

const occurrence = {
  sessionId: "session-1",
  source: "text" as const,
  encodingId: "bijoy",
  engineVersion: "1.0.0",
  rulesHash: "abc123",
  failureCategory: "unmapped_character" as const,
  failedSequence: "Av",
  position: 7,
  contextBefore: "before ",
  contextAfter: " after",
  errorCode: "UNMAPPED_CHARACTER",
  errorReason: '"Av" occurred 1 time(s) with no mapping rule in this encoding.',
  severity: "warning" as const,
  fileName: null,
  fileType: null,
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/conversion-failures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/conversion-failures", () => {
  beforeEach(() => {
    vi.mocked(recordConversionFailures).mockClear();
  });

  it("records an occurrence sent by the current client", async () => {
    const response = await POST(makeRequest({ failures: [occurrence] }));

    expect(response.status).toBe(200);
    expect(recordConversionFailures).toHaveBeenCalledTimes(1);
    const [recorded] = vi.mocked(recordConversionFailures).mock.calls[0][0];
    expect(recorded.failedSequence).toBe("Av");
    expect(recorded.contextBefore).toBe("before ");
  });

  it("accepts a stale client that still sends fullText, but never forwards it", async () => {
    const response = await POST(makeRequest({ failures: [{ ...occurrence, fullText: "whole doc", engineOutput: "whole output" }] }));

    expect(response.status).toBe(200);
    const [recorded] = vi.mocked(recordConversionFailures).mock.calls[0][0];
    expect(recorded).not.toHaveProperty("fullText");
    expect(recorded.engineOutput).toBeNull();
    expect(JSON.stringify(recorded)).not.toContain("whole doc");
    expect(JSON.stringify(recorded)).not.toContain("whole output");
  });

  it("rejects an oversized context window instead of storing it", async () => {
    const response = await POST(
      makeRequest({ failures: [{ ...occurrence, contextBefore: "x".repeat(10_000) }] }),
    );

    expect(response.status).toBe(400);
    expect(recordConversionFailures).not.toHaveBeenCalled();
  });

  it("rejects an oversized fullText from a stale client rather than parsing it", async () => {
    const response = await POST(makeRequest({ failures: [{ ...occurrence, fullText: "x".repeat(200_000) }] }));

    expect(response.status).toBe(400);
    expect(recordConversionFailures).not.toHaveBeenCalled();
  });

  it("never reads userId from the request body", async () => {
    await POST(makeRequest({ failures: [{ ...occurrence, userId: "attacker-uid" }] }));

    const [recorded] = vi.mocked(recordConversionFailures).mock.calls[0][0];
    expect(recorded.userId).toBeNull();
  });
});

/**
 * A batched report moves an aggregate by more than one, so the count is now
 * an input worth validating rather than an implied 1.
 */
describe("POST /api/conversion-failures: batched counts", () => {
  beforeEach(() => {
    vi.mocked(recordConversionFailures).mockClear();
  });

  it("forwards the reported count", async () => {
    await POST(makeRequest({ failures: [{ ...occurrence, occurrenceCount: 47 }] }));
    const [recorded] = vi.mocked(recordConversionFailures).mock.calls[0][0];
    expect(recorded.occurrenceCount).toBe(47);
  });

  it("defaults to one when a pre-batching client omits it", async () => {
    await POST(makeRequest({ failures: [occurrence] }));
    const [recorded] = vi.mocked(recordConversionFailures).mock.calls[0][0];
    expect(recorded.occurrenceCount).toBe(1);
  });

  it("rejects a count above the ceiling rather than clamping it silently", async () => {
    const response = await POST(
      makeRequest({
        failures: [{ ...occurrence, occurrenceCount: CONVERSION_FAILURE_LIMITS.maxOccurrenceCount + 1 }],
      }),
    );
    expect(response.status).toBe(400);
    expect(recordConversionFailures).not.toHaveBeenCalled();
  });

  it("rejects a count that is zero, negative, or fractional", async () => {
    for (const occurrenceCount of [0, -1, 1.5]) {
      vi.mocked(recordConversionFailures).mockClear();
      const response = await POST(makeRequest({ failures: [{ ...occurrence, occurrenceCount }] }));
      expect(response.status, `occurrenceCount=${occurrenceCount}`).toBe(400);
      expect(recordConversionFailures).not.toHaveBeenCalled();
    }
  });

  it("accepts a full batch of distinct patterns in one request", async () => {
    const failures = Array.from({ length: CONVERSION_FAILURE_LIMITS.maxFailuresPerReport }, (_, i) => ({
      ...occurrence,
      failedSequence: `seq-${i}`,
      occurrenceCount: i + 1,
    }));
    const response = await POST(makeRequest({ failures }));

    expect(response.status).toBe(200);
    // One request, not one per pattern — the point of batching.
    expect(recordConversionFailures).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordConversionFailures).mock.calls[0][0]).toHaveLength(
      CONVERSION_FAILURE_LIMITS.maxFailuresPerReport,
    );
  });

  it("still refuses a batch larger than one request may carry", async () => {
    const failures = Array.from({ length: CONVERSION_FAILURE_LIMITS.maxFailuresPerReport + 1 }, (_, i) => ({
      ...occurrence,
      failedSequence: `seq-${i}`,
    }));
    const response = await POST(makeRequest({ failures }));

    expect(response.status).toBe(400);
    expect(recordConversionFailures).not.toHaveBeenCalled();
  });

  /**
   * The builder already reduces the name before the request is made, so this
   * covers the two cases the builder cannot: a tab still running the previous
   * bundle, and a caller that is not our client.
   */
  it("reduces a file name a caller sent anyway to its extension", async () => {
    const response = await POST(
      makeRequest({
        failures: [{ ...occurrence, source: "file", fileName: "q3-layoffs-draft.docx", fileType: "docx" }],
      }),
    );

    expect(response.status).toBe(200);
    const [recorded] = vi.mocked(recordConversionFailures).mock.calls[0][0];
    expect(recorded.fileName).toBe(".docx");
    expect(JSON.stringify(recorded)).not.toContain("q3-layoffs-draft");
  });
});

describe("POST /api/conversion-failures body ceiling", () => {
  beforeEach(() => {
    vi.mocked(recordConversionFailures).mockClear();
  });

  it("refuses an oversized body with 413 and never reaches the writer", async () => {
    // The schema would reject this too — but only after buffering it. The
    // point of the ceiling is that nothing downstream, including zod, sees
    // a payload this size at all.
    const { MAX_JSON_BODY_BYTES } = await import("@/lib/security/readJsonBody");
    const filler = "a".repeat(MAX_JSON_BODY_BYTES + 1024);
    const response = await POST(makeRequest({ failures: [{ ...occurrence, errorReason: filler }] }));

    expect(response.status).toBe(413);
    expect(recordConversionFailures).not.toHaveBeenCalled();
  });

  it("still accepts a report at the largest size the schema allows", async () => {
    // Guards against a ceiling set below the legitimate maximum, which
    // would reject real reports and look like a client bug.
    const maximal = {
      ...occurrence,
      failedSequence: "A".repeat(CONVERSION_FAILURE_LIMITS.maxFailedSequenceLength),
      contextBefore: "b".repeat(CONVERSION_FAILURE_LIMITS.maxContextLength),
      contextAfter: "c".repeat(CONVERSION_FAILURE_LIMITS.maxContextLength),
      errorReason: "r".repeat(CONVERSION_FAILURE_LIMITS.maxErrorReasonLength),
    };
    const failures = Array.from({ length: CONVERSION_FAILURE_LIMITS.maxFailuresPerReport }, (_, i) => ({
      ...maximal,
      sessionId: `session-${i}`,
    }));

    const response = await POST(makeRequest({ failures }));

    expect(response.status).toBe(200);
    expect(recordConversionFailures).toHaveBeenCalledTimes(1);
  });
});
