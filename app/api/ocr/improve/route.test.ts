import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppErrors } from "@/lib/errors/types";
import { OCR_AI_LIMITS } from "@/lib/ocr/limits";

vi.mock("@/lib/auth/session", () => ({
  requireServerUser: vi.fn(),
}));

vi.mock("@/lib/ai/ocrImages", () => ({
  readOcrImages: vi.fn(),
  isOcrAiAvailable: vi.fn(),
}));

vi.mock("@/lib/security/sharedRateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/sharedRateLimit")>();
  return { ...actual, checkSharedRateLimit: vi.fn(async () => ({ ok: true })) };
});

import { requireServerUser } from "@/lib/auth/session";
import { isOcrAiAvailable, readOcrImages } from "@/lib/ai/ocrImages";
import { checkSharedRateLimit } from "@/lib/security/sharedRateLimit";
import { GET, POST } from "./route";

const URL = "http://localhost/api/ocr/improve";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.7 not an image");

function file(bytes: Uint8Array, name = "crop.jpg", type = "image/jpeg") {
  return new File([bytes as BlobPart], name, { type });
}

function formWith(entries: Record<string, File | string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

function post(form: FormData, headers: Record<string, string> = {}) {
  return POST(new NextRequest(URL, { method: "POST", headers: { authorization: "Bearer t", ...headers }, body: form }));
}

function signedIn() {
  vi.mocked(requireServerUser).mockResolvedValue({
    ok: true,
    value: { uid: "user-1", role: "user" } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkSharedRateLimit).mockResolvedValue({ ok: true } as never);
  vi.mocked(readOcrImages).mockResolvedValue({
    ok: true,
    value: { texts: ["ক"], provider: "gemini", model: "m", promptVersion: "ocr-v2" },
  });
  signedIn();
});

describe("POST /api/ocr/improve", () => {
  it("rejects an anonymous caller with 401 before doing anything else", async () => {
    vi.mocked(requireServerUser).mockResolvedValue({ ok: false, error: AppErrors.authentication("Sign in to continue.") });
    const response = await post(formWith({ "image-0": file(JPEG) }));
    expect(response.status).toBe(401);
    expect(checkSharedRateLimit).not.toHaveBeenCalled();
    expect(readOcrImages).not.toHaveBeenCalled();
  });

  it("rate limits per signed-in user, with Retry-After, before reading the body", async () => {
    vi.mocked(checkSharedRateLimit).mockResolvedValue({
      ok: false,
      error: AppErrors.rateLimit("Too many requests.", { details: { retryAfterSeconds: 42 } }),
    } as never);
    const response = await post(formWith({ "image-0": file(JPEG) }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(readOcrImages).not.toHaveBeenCalled();
    expect(vi.mocked(checkSharedRateLimit).mock.calls[0][0]).toMatchObject({
      key: "ocr-improve:uid:user-1",
      shared: true,
      ...OCR_AI_LIMITS.rateLimit,
    });
  });

  it("rejects an oversize declared body before parsing it", async () => {
    const request = new NextRequest(URL, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-length": String(OCR_AI_LIMITS.maxRequestBytes + 100_000) },
      body: formWith({ "image-0": file(JPEG) }),
    });
    const formData = vi.spyOn(request, "formData");
    const response = await POST(request);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(formData).not.toHaveBeenCalled();
    expect(readOcrImages).not.toHaveBeenCalled();
  });

  it.each([
    ["no images", {}],
    ["a gap in the numbering", { "image-1": file(JPEG) }],
    ["an image field past the limit", { "image-0": file(JPEG), "image-9": file(JPEG) }],
    ["too many images", Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`image-${i}`, file(JPEG)]))],
    ["an image field that is not a file", { "image-0": "just a string" }],
    ["a file over the per-image cap", { "image-0": file(new Uint8Array(OCR_AI_LIMITS.maxImageBytes + 1).fill(0xff)) }],
    ["a 'JPEG' that is really a PDF", { "image-0": file(PDF, "crop.jpg", "image/jpeg") }],
  ])("returns 400 for %s, without calling the service", async (_name, entries) => {
    const response = await post(formWith(entries as Record<string, File | string>));
    expect(response.status).toBe(400);
    expect(readOcrImages).not.toHaveBeenCalled();
  });

  it("derives each image's mime type from its bytes, not the client's claim", async () => {
    const response = await post(
      formWith({ "image-0": file(PNG, "a.jpg", "image/jpeg"), "image-1": file(JPEG, "b.png", "image/png") }),
    );
    expect(response.status).toBe(200);
    const sent = vi.mocked(readOcrImages).mock.calls[0][0];
    expect(sent.map((i) => i.mimeType)).toEqual(["image/png", "image/jpeg"]);
    expect(Buffer.from(sent[0].data)).toEqual(Buffer.from(PNG));
  });

  it("returns only texts, provider and model on success", async () => {
    const response = await post(formWith({ "image-0": file(JPEG) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ ok: true, texts: ["ক"], provider: "gemini", model: "m" });
  });

  it("never leaks a provider's debug detail", async () => {
    vi.mocked(readOcrImages).mockResolvedValue({
      ok: false,
      error: AppErrors.unknown("AI reading failed.", { debug: "SECRET-DEBUG-DETAIL" }),
    });
    const response = await post(formWith({ "image-0": file(JPEG) }));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(await response.json())).not.toContain("SECRET-DEBUG-DETAIL");
  });

  it("maps a switched-off deployment to the NOT_FOUND shape the client treats as 'unavailable'", async () => {
    vi.mocked(readOcrImages).mockResolvedValue({ ok: false, error: AppErrors.notFound("AI text reading is disabled.") });
    const response = await post(formWith({ "image-0": file(JPEG) }));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND_ERROR");
  });
});

describe("GET /api/ocr/improve", () => {
  it("rejects an anonymous caller", async () => {
    vi.mocked(requireServerUser).mockResolvedValue({ ok: false, error: AppErrors.authentication("Sign in to continue.") });
    const response = await GET(new NextRequest(URL));
    expect(response.status).toBe(401);
    expect(isOcrAiAvailable).not.toHaveBeenCalled();
  });

  it.each([true, false])("reports availability %s without calling the provider", async (available) => {
    vi.mocked(isOcrAiAvailable).mockResolvedValue(available);
    const response = await GET(new NextRequest(URL, { headers: { authorization: "Bearer t" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ ok: true, available });
    expect(readOcrImages).not.toHaveBeenCalled();
  });
});
