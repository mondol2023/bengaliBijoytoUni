/**
 * Whole-document transcription: its own switch, its share of the daily
 * budget, and what actually leaves the process. `fetch` is mocked rather than
 * the provider, so a request that bypassed the registry would still show up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryCounterStore } from "@/lib/security/counterStore";
import { AI_RESOLUTION_ENABLED_ENV, AI_TRANSCRIPTION_ENABLED_ENV } from "../enabled";

vi.mock("@/lib/firebase/sharedCounter", () => ({ firestoreCounterStore: createMemoryCounterStore() }));

const PDF = { mimeType: "application/pdf", data: Buffer.from("%PDF-1.4 fake") };

function geminiReply(text: string, finishReason = "STOP") {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }),
  } as Response;
}

async function freshService() {
  vi.resetModules();
  return import("../transcribeDocument");
}

describe("transcribeDocument", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-a-real-credential");
    fetchMock = vi.fn().mockResolvedValue(geminiReply("বাংলাদেশ সুপ্রীম কোর্ট\nCall for the records"));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("makes no call while its switch is off, even with a key present", async () => {
    vi.stubEnv(AI_TRANSCRIPTION_ENABLED_ENV, undefined);
    const { transcribeDocument } = await freshService();
    const result = await transcribeDocument({ file: PDF, fileName: "judgment.pdf" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is not armed by the admin resolution switch", async () => {
    vi.stubEnv(AI_RESOLUTION_ENABLED_ENV, "true");
    vi.stubEnv(AI_TRANSCRIPTION_ENABLED_ENV, undefined);
    const { transcribeDocument } = await freshService();
    expect((await transcribeDocument({ file: PDF, fileName: "judgment.pdf" })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a PDF as the file itself, so image pages are read too", async () => {
    vi.stubEnv(AI_TRANSCRIPTION_ENABLED_ENV, "true");
    const { transcribeDocument } = await freshService();
    const result = await transcribeDocument({ file: PDF, fileName: "judgment.pdf" });

    expect(result.ok && result.value.text).toBe("বাংলাদেশ সুপ্রীম কোর্ট\nCall for the records");
    expect(result.ok && result.value.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.contents[0].parts[0].inlineData).toEqual({
      mimeType: "application/pdf",
      data: PDF.data.toString("base64"),
    });
    expect(body.generationConfig.responseMimeType).toBe("text/plain");
  });

  it("sends extracted text for formats the provider cannot read", async () => {
    vi.stubEnv(AI_TRANSCRIPTION_ENABLED_ENV, "true");
    const { transcribeDocument } = await freshService();
    await transcribeDocument({ text: "Rbve wePvicwZ", fileName: "order.docx" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.contents[0].parts[0].text).toContain("Rbve wePvicwZ");
  });

  it("flags a transcription cut off at the output limit", async () => {
    vi.stubEnv(AI_TRANSCRIPTION_ENABLED_ENV, "true");
    fetchMock.mockResolvedValue(geminiReply("প্রথম অংশ", "MAX_TOKENS"));
    const { transcribeDocument } = await freshService();
    const result = await transcribeDocument({ file: PDF, fileName: "judgment.pdf" });
    expect(result.ok && result.value.truncated).toBe(true);
  });

  it("makes exactly one call on a provider failure — a whole-document call is never retried", async () => {
    vi.stubEnv(AI_TRANSCRIPTION_ENABLED_ENV, "true");
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "down", json: async () => ({}) } as Response);
    const { transcribeDocument } = await freshService();
    const result = await transcribeDocument({ file: PDF, fileName: "judgment.pdf" });
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at the daily call budget", async () => {
    vi.stubEnv(AI_TRANSCRIPTION_ENABLED_ENV, "true");
    vi.stubEnv("AI_DAILY_CALL_BUDGET", "1");
    // A store of its own: the shared mock has already counted earlier tests' calls today.
    vi.doMock("@/lib/firebase/sharedCounter", () => ({ firestoreCounterStore: createMemoryCounterStore() }));
    const { transcribeDocument } = await freshService();
    expect((await transcribeDocument({ file: PDF, fileName: "a.pdf" })).ok).toBe(true);
    const second = await transcribeDocument({ file: PDF, fileName: "b.pdf" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("RATE_LIMIT_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a file over the provider's inline limit without spending a call", async () => {
    vi.stubEnv(AI_TRANSCRIPTION_ENABLED_ENV, "true");
    const { transcribeDocument } = await freshService();
    const big = { mimeType: "application/pdf", data: Buffer.alloc(15 * 1024 * 1024) };
    expect((await transcribeDocument({ file: big, fileName: "big.pdf" })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
