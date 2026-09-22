import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppErrors } from "@/lib/errors/types";
import type { WithId } from "@/lib/firebase/conversionFailures";
import type { AiResolution } from "@/lib/firebase/schemas";

/**
 * Final integration test for Phase 7 (mirrors the Phase 6 resolve route
 * test): a full mocked flow from an admin HTTP request through
 * authentication → validation → the review service → a safe JSON response,
 * without ever touching real Firestore. `reviewConversionResolution` itself
 * is exercised separately in `lib/ai/reviewConversionResolution.test.ts`.
 */
vi.mock("@/lib/auth/session", () => ({
  requireAdminUser: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  isFirebaseAdminConfigured: true,
}));

vi.mock("@/lib/firebase/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/reviewConversionResolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/reviewConversionResolution")>();
  return { ...actual, reviewConversionResolution: vi.fn() };
});

vi.mock("@/lib/security/rateLimit", () => ({
  checkRateLimit: vi.fn(),
}));

import { requireAdminUser } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/firebase/audit";
import { reviewConversionResolution } from "@/lib/ai/reviewConversionResolution";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { POST } from "./route";

const ADMIN_UID = "admin-uid-1";
const PATTERN_ID = "pattern-1";
const RESOLUTION_ID = "resolution-doc-1";
const ROUTE_URL = `http://localhost/api/admin/conversion-failures/${PATTERN_ID}/review`;

function makeRequest(body: unknown, { asJson = true }: { asJson?: boolean } = {}): NextRequest {
  return new NextRequest(ROUTE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: asJson ? JSON.stringify(body) : (body as string),
  });
}

function params(patternId: string | undefined = PATTERN_ID) {
  return { params: Promise.resolve({ patternId: patternId ?? "" }) };
}

function makeResolution(overrides: Partial<AiResolution> = {}): WithId<AiResolution> {
  return {
    id: RESOLUTION_ID,
    patternId: PATTERN_ID,
    encodingId: "bijoy",
    failedSequence: "Av",
    lookupKey: "lookup-key-1",
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: "v1",
    engineVersion: "engine-1.2.3",
    rulesHash: "rules-abc",
    candidateConversion: "é",
    reasoningSummary: "Matches a known accented-character mapping.",
    confidence: "high",
    alternativeCandidates: [],
    isCertain: true,
    rawResponse: null,
    status: "reviewed",
    reviewDecision: "accepted",
    reviewedBy: ADMIN_UID,
    reviewedAt: "2026-01-03T00:00:00.000Z",
    reviewNote: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireAdminUser).mockReset();
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined);
  vi.mocked(reviewConversionResolution).mockReset();
  vi.mocked(checkRateLimit).mockReset().mockReturnValue({ ok: true });
});

describe("POST /api/admin/conversion-failures/[patternId]/review — authentication/authorization", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: false, error: AppErrors.authentication("Sign in to continue.") });

    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params());
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("AUTHENTICATION_ERROR");
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is authenticated but not an admin", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: false, error: AppErrors.authorization("Admin access required.") });

    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params());
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("AUTHORIZATION_ERROR");
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("allows an authenticated admin through to the review service", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: true, value: { uid: ADMIN_UID, email: "admin@example.com", role: "admin" } });
    vi.mocked(reviewConversionResolution).mockResolvedValue({ ok: true, value: { resolution: makeResolution(), alreadyReviewed: false } });

    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params());

    expect(response.status).toBe(200);
    expect(reviewConversionResolution).toHaveBeenCalled();
  });
});

describe("POST /api/admin/conversion-failures/[patternId]/review — request validation", () => {
  beforeEach(() => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: true, value: { uid: ADMIN_UID, email: "admin@example.com", role: "admin" } });
  });

  it("returns 400 when the patternId route param is missing", async () => {
    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params(""));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    const response = await POST(makeRequest("not json{{", { asJson: false }), params());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("returns 400 when resolutionId is missing", async () => {
    const response = await POST(makeRequest({ decision: "accepted" }), params());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("returns 400 when decision is missing", async () => {
    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID }), params());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid decision value, with no silent coercion", async () => {
    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "maybe" }), params());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("rejects a reviewNote longer than the configured limit", async () => {
    const response = await POST(
      makeRequest({ resolutionId: RESOLUTION_ID, decision: "rejected", reviewNote: "x".repeat(10_000) }),
      params(),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("never trusts a client-supplied reviewer identity — only patternId/resolutionId/decision/reviewNote reach the service", async () => {
    vi.mocked(reviewConversionResolution).mockResolvedValue({ ok: true, value: { resolution: makeResolution(), alreadyReviewed: false } });

    await POST(
      makeRequest({
        resolutionId: RESOLUTION_ID,
        decision: "accepted",
        // Anything else a malicious/buggy client sends must be ignored, not forwarded.
        reviewedBy: "attacker-supplied-uid",
        isAdmin: true,
        role: "admin",
        userId: "attacker-supplied-uid",
      }),
      params(),
    );

    expect(reviewConversionResolution).toHaveBeenCalledWith({
      patternId: PATTERN_ID,
      resolutionId: RESOLUTION_ID,
      decision: "accepted",
      reviewedBy: ADMIN_UID,
      reviewNote: undefined,
    });
  });
});

describe("POST /api/admin/conversion-failures/[patternId]/review — rate limiting", () => {
  beforeEach(() => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: true, value: { uid: ADMIN_UID, email: "admin@example.com", role: "admin" } });
  });

  it("returns 429 and never calls the review service when the rate limit is exceeded", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: false,
      error: AppErrors.rateLimit("Too many requests — please wait a moment and try again.", { details: { retryAfterSeconds: 42 } }),
    });

    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params());
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("RATE_LIMIT_ERROR");
    expect(reviewConversionResolution).not.toHaveBeenCalled();
  });

  it("keys the rate limit on the authenticated admin's uid", async () => {
    vi.mocked(reviewConversionResolution).mockResolvedValue({ ok: true, value: { resolution: makeResolution(), alreadyReviewed: false } });

    await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params());

    expect(checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: `ai-review:${ADMIN_UID}` }));
  });
});

describe("POST /api/admin/conversion-failures/[patternId]/review — end-to-end success/failure", () => {
  beforeEach(() => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: true, value: { uid: ADMIN_UID, email: "admin@example.com", role: "admin" } });
  });

  it("on success, returns 200 with the resolution and writes an audit log entry", async () => {
    const resolution = makeResolution();
    vi.mocked(reviewConversionResolution).mockResolvedValue({ ok: true, value: { resolution, alreadyReviewed: false } });

    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, resolution, alreadyReviewed: false });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: ADMIN_UID,
        action: "conversionFailure.review",
        target: `aiResolutions/${RESOLUTION_ID}`,
        metadata: expect.objectContaining({ patternId: PATTERN_ID, decision: "accepted", alreadyReviewed: false }),
      }),
    );
  });

  it("propagates the service's AppError code/status and skips the audit log on failure", async () => {
    vi.mocked(reviewConversionResolution).mockResolvedValue({
      ok: false,
      error: AppErrors.notFound(`No AI resolution "${RESOLUTION_ID}" was found for this failure pattern.`),
    });

    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params());
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND_ERROR");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns 409 and skips the audit log on an invalid/terminal state transition", async () => {
    vi.mocked(reviewConversionResolution).mockResolvedValue({
      ok: false,
      error: AppErrors.conflict("This AI resolution was already reviewed with a different decision."),
    });

    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "rejected" }), params());
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("CONFLICT_ERROR");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("never leaks a debug payload in the HTTP response body", async () => {
    vi.mocked(reviewConversionResolution).mockResolvedValue({
      ok: false,
      error: AppErrors.database("Could not update the AI resolution review.", {
        debug: { secret: "sk-should-never-appear", cause: new Error("firestore boom") },
      }),
    });

    const response = await POST(makeRequest({ resolutionId: RESOLUTION_ID, decision: "accepted" }), params());
    const rawBody = await response.text();

    expect(rawBody).not.toMatch(/sk-should-never-appear/);
    expect(rawBody).not.toMatch(/firestore boom/);
    expect(JSON.parse(rawBody).error).not.toHaveProperty("debug");
  });
});
