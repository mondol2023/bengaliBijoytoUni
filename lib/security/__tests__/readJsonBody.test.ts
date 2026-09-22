/**
 * The ceiling has to hold against a caller who is not our client: one that
 * omits `Content-Length`, one that understates it, and one that simply
 * sends too much. Each of those is a separate test here because each takes
 * a different path through the reader.
 */
import { describe, expect, it } from "vitest";
import { MAX_JSON_BODY_BYTES, readJsonBody } from "../readJsonBody";

/** A request whose body is a real stream, as a runtime would deliver it. */
function streamed(bytes: Uint8Array, headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Chunked deliberately: the reader must count across chunks, not
      // trust one buffer's length.
      for (let i = 0; i < bytes.byteLength; i += 1024) {
        controller.enqueue(bytes.slice(i, i + 1024));
      }
      controller.close();
    },
  });
  return new Request("https://example.test/api", {
    method: "POST",
    body: stream,
    headers,
    // Required by undici for a streaming body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

const encoder = new TextEncoder();

describe("readJsonBody accepts what it should", () => {
  it("parses an ordinary body", async () => {
    const result = await readJsonBody(streamed(encoder.encode(JSON.stringify({ a: 1 }))));
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reports invalid JSON as a validation error, not a size error", async () => {
    const result = await readJsonBody(streamed(encoder.encode("{ not json")));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts a body exactly at the ceiling", async () => {
    // Off-by-one guard: the check is `> maxBytes`, so the boundary value
    // must pass. A ceiling that rejects its own stated limit is a bug
    // nobody notices until a legitimate client sits on the boundary.
    const filler = "a".repeat(100 - 12);
    const json = JSON.stringify({ v: filler });
    const result = await readJsonBody(streamed(encoder.encode(json)), encoder.encode(json).byteLength);
    expect(result.ok).toBe(true);
  });
});

describe("readJsonBody refuses what it should", () => {
  it("rejects on Content-Length before touching the body", async () => {
    // A hand-built request rather than a real one: undici drains a
    // streaming body while constructing `Request`, so a spy on the stream
    // would fire before `readJsonBody` is even called and prove nothing.
    // Here the body and `.text()` both throw, so reaching either fails the
    // test for the right reason.
    let touched = false;
    const request = {
      headers: new Headers({ "content-length": String(MAX_JSON_BODY_BYTES + 1) }),
      get body(): ReadableStream<Uint8Array> {
        touched = true;
        throw new Error("body read despite an oversized Content-Length");
      },
      text() {
        touched = true;
        throw new Error("text() called despite an oversized Content-Length");
      },
    } as unknown as Request;

    const result = await readJsonBody(request);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LIMIT_EXCEEDED_ERROR");
    expect(touched).toBe(false);
  });

  it("rejects an oversized body that declares no length at all", async () => {
    const big = encoder.encode(`{"v":"${"a".repeat(200)}"}`);
    const result = await readJsonBody(streamed(big), 64);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LIMIT_EXCEEDED_ERROR");
  });

  it("rejects an oversized body that lies about its length", async () => {
    // The whole reason the streaming count exists: Content-Length is the
    // caller's claim, not a fact.
    const big = encoder.encode(`{"v":"${"a".repeat(2000)}"}`);
    const result = await readJsonBody(streamed(big, { "content-length": "10" }), 64);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LIMIT_EXCEEDED_ERROR");
  });

  it("ignores an unparseable Content-Length and still meters the stream", async () => {
    const big = encoder.encode(`{"v":"${"a".repeat(2000)}"}`);
    const result = await readJsonBody(streamed(big, { "content-length": "not-a-number" }), 64);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LIMIT_EXCEEDED_ERROR");
  });

  it("counts bytes, not characters", async () => {
    // Three-byte Bengali: 40 characters is 120 bytes. A `.length` check
    // would pass this and a byte check must not.
    const text = JSON.stringify({ v: "ক".repeat(40) });
    const result = await readJsonBody(streamed(encoder.encode(text)), 100);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LIMIT_EXCEEDED_ERROR");
  });
});

describe("the default ceiling is above the largest legitimate report", () => {
  it("leaves headroom over 50 maximal entries", async () => {
    // Guards the constant against a schema change that raises the bounds
    // past it — the failure mode would be legitimate reports rejected as
    // abuse, which is silent from the server's side.
    const { CONVERSION_FAILURE_LIMITS } = await import("@/lib/conversionFailures/limits");
    const perEntryCodeUnits =
      100 + // sessionId
      64 + // encodingId
      32 + // engineVersion
      64 + // rulesHash
      CONVERSION_FAILURE_LIMITS.maxFailedSequenceLength +
      CONVERSION_FAILURE_LIMITS.maxContextLength * 4 + // before, after, fullText, engineOutput
      64 + // errorCode
      CONVERSION_FAILURE_LIMITS.maxErrorReasonLength +
      256 + // fileName
      32; // fileType
    const worstCaseBytes = CONVERSION_FAILURE_LIMITS.maxFailuresPerReport * perEntryCodeUnits * 3;
    expect(MAX_JSON_BODY_BYTES).toBeGreaterThan(worstCaseBytes);
  });
});
