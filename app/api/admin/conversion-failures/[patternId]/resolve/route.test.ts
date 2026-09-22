import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppErrors } from "@/lib/errors/types";
import type { WithId } from "@/lib/firebase/conversionFailures";
import type { AiResolution } from "@/lib/firebase/schemas";

/**
 * Final integration test for Phase 6 (spec §28): a full mocked flow from an
 * admin HTTP request through authentication → validation → the resolution
 * service → a safe JSON response, without ever touching real Firestore or a
 * real AI provider. Every collaborator `route.ts` calls is mocked here;
 * `resolveConversionFailure` itself is exercised separately (and far more
 * thoroughly) in `lib/ai/resolveConversionFailure.test.ts`.
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

vi.mock("@/lib/ai/resolveConversionFailure", () => ({
  resolveConversionFailure: vi.fn(),
}));

vi.mock("@/lib/security/rateLimit", () => ({
  checkRateLimit: vi.fn(),
}));

import { requireAdminUser } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/firebase/audit";
import { resolveConversionFailure } from "@/lib/ai/resolveConversionFailure";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { POST } from "./route";

const ADMIN_UID = "admin-uid-1";
const PATTERN_ID = "pattern-1";
const ROUTE_URL = `http://localhost/api/admin/conversion-failures/${PATTERN_ID}/resolve`;

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
    id: "resolution-doc-1",
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
    status: "completed",
    hitCount: 0,
    lastUsedAt: null,
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireAdminUser).mockReset();
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined);
  vi.mocked(resolveConversionFailure).mockReset();
  vi.mocked(checkRateLimit).mockReset().mockReturnValue({ ok: true });
});

describe("POST /api/admin/conversion-failures/[patternId]/resolve — authentication/authorization", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: false, error: AppErrors.authentication("Sign in to continue.") });

    const response = await POST(makeRequest({ provider: "gemini" }), params());
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("AUTHENTICATION_ERROR");
    expect(resolveConversionFailure).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is authenticated but not an admin", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: false, error: AppErrors.authorization("Admin access required.") });

    const response = await POST(makeRequest({ provider: "gemini" }), params());
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("AUTHORIZATION_ERROR");
    expect(resolveConversionFailure).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/conversion-failures/[patternId]/resolve — request validation", () => {
  beforeEach(() => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: true, value: { uid: ADMIN_UID, email: "admin@example.com", role: "admin" } });
  });

  it("returns 400 when the patternId route param is missing", async () => {
    const response = await POST(makeRequest({ provider: "gemini" }), params(""));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(resolveConversionFailure).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    const response = await POST(makeRequest("not json{{", { asJson: false }), params());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(resolveConversionFailure).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown/unsupported provider, with no silent fallback", async () => {
    const response = await POST(makeRequest({ provider: "chatgpt-web-search" }), params());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(resolveConversionFailure).not.toHaveBeenCalled();
  });

  it("never trusts client-supplied failure content — only provider/includeContext/includeFullText reach the service", async () => {
    vi.mocked(resolveConversionFailure).mockResolvedValue({ ok: true, value: { resolution: makeResolution(), reused: false } });

    await POST(
      makeRequest({
        provider: "gemini",
        includeContext: true,
        // Anything else a malicious/buggy client sends must be ignored, not forwarded.
        encodingId: "attacker-supplied",
        failedSequence: "attacker-supplied",
        engineVersion: "attacker-supplied",
        rulesHash: "attacker-supplied",
      }),
      params(),
    );

    expect(resolveConversionFailure).toHaveBeenCalledWith({
      patternId: PATTERN_ID,
      providerId: "gemini",
      includeContext: true,
      includeFullText: false,
    });
  });
});

describe("POST /api/admin/conversion-failures/[patternId]/resolve — rate limiting", () => {
  beforeEach(() => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: true, value: { uid: ADMIN_UID, email: "admin@example.com", role: "admin" } });
  });

  it("returns 429 and never calls the resolution service when the rate limit is exceeded", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: false,
      error: AppErrors.rateLimit("Too many requests — please wait a moment and try again.", { details: { retryAfterSeconds: 42 } }),
    });

    const response = await POST(makeRequest({ provider: "gemini" }), params());
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("RATE_LIMIT_ERROR");
    expect(resolveConversionFailure).not.toHaveBeenCalled();
  });

  it("keys the rate limit on the authenticated admin's uid", async () => {
    vi.mocked(resolveConversionFailure).mockResolvedValue({ ok: true, value: { resolution: makeResolution(), reused: false } });

    await POST(makeRequest({ provider: "gemini" }), params());

    expect(checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: `ai-resolve:${ADMIN_UID}` }));
  });
});

describe("POST /api/admin/conversion-failures/[patternId]/resolve — end-to-end success/failure", () => {
  beforeEach(() => {
    vi.mocked(requireAdminUser).mockResolvedValue({ ok: true, value: { uid: ADMIN_UID, email: "admin@example.com", role: "admin" } });
  });

  it("on success, returns 200 with the resolution and writes an audit log entry", async () => {
    const resolution = makeResolution();
    vi.mocked(resolveConversionFailure).mockResolvedValue({ ok: true, value: { resolution, reused: false } });

    const response = await POST(makeRequest({ provider: "gemini" }), params());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, resolution, reused: false });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: ADMIN_UID,
        action: "conversionFailure.resolve",
        target: `failurePatterns/${PATTERN_ID}`,
        metadata: expect.objectContaining({ provider: "gemini", reused: false, status: "completed" }),
      }),
    );
  });

  it("propagates the service's AppError code/status and skips the audit log on failure", async () => {
    vi.mocked(resolveConversionFailure).mockResolvedValue({
      ok: false,
      error: AppErrors.notFound(`No failure pattern "${PATTERN_ID}" was found.`),
    });

    const response = await POST(makeRequest({ provider: "gemini" }), params());
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND_ERROR");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("never leaks a debug payload in the HTTP response body", async () => {
    vi.mocked(resolveConversionFailure).mockResolvedValue({
      ok: false,
      error: AppErrors.database("The AI provider produced a result, but it could not be saved. Please try again.", {
        debug: { secret: "sk-should-never-appear", cause: new Error("firestore boom") },
      }),
    });

    const response = await POST(makeRequest({ provider: "gemini" }), params());
    const rawBody = await response.text();

    expect(rawBody).not.toMatch(/sk-should-never-appear/);
    expect(rawBody).not.toMatch(/firestore boom/);
    expect(JSON.parse(rawBody).error).not.toHaveProperty("debug");
  });
});
