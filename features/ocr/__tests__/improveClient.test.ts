import { describe, expect, it, vi } from "vitest";
import { createImproveClient } from "../fallback/improveClient";

const blob = (text: string) => new Blob([text], { type: "image/jpeg" });
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

function setup(response: () => Promise<Response>, token: string | null = "tok") {
  const fetchMock = vi.fn(response);
  const client = createImproveClient({
    fetch: fetchMock as unknown as typeof fetch,
    getToken: async () => token,
  });
  return { client, fetchMock };
}

const callArgs = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls[0] as unknown as [string, RequestInit];

describe("improve", () => {
  it("posts one image-<i> field per blob, in order, with the Bearer token", async () => {
    const { client, fetchMock } = setup(async () =>
      json({ ok: true, texts: ["ক", "খ"], provider: "gemini", model: "m" }),
    );
    const result = await client.improve([blob("one"), blob("two")]);

    expect(result).toEqual({ ok: true, value: { texts: ["ক", "খ"], provider: "gemini", model: "m" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("/api/ocr/improve");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["image-0", "image-1"]);
    const first = form.get("image-0") as File;
    expect(first.name).toBe("crop.jpg");
    expect(await first.text()).toBe("one");
    expect(await (form.get("image-1") as File).text()).toBe("two");
  });

  it("returns the server's safe error with its code", async () => {
    const { client } = setup(async () =>
      json(
        { ok: false, error: { code: "RATE_LIMIT_ERROR", message: "Slow down.", details: { retryAfterSeconds: 9 } } },
        429,
      ),
    );
    const result = await client.improve([blob("x")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RATE_LIMIT_ERROR");
      expect(result.error.message).toBe("Slow down.");
    }
  });

  it("makes no request without a token", async () => {
    const { client, fetchMock } = setup(async () => json({}), null);
    const result = await client.improve([blob("x")]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AUTHENTICATION_ERROR");
      expect(result.error.message).toBe("Sign in to improve readings with AI.");
    }
  });

  it("turns a rejected fetch into an error", async () => {
    const { client } = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await client.improve([blob("x")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN_ERROR");
      expect(result.error.message).toBe("Couldn't reach the server.");
    }
  });

  it("turns a non-JSON body into an error", async () => {
    const { client } = setup(
      async () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError("bad");
          },
        }) as unknown as Response,
    );
    expect((await client.improve([blob("x")])).ok).toBe(false);
  });

  it.each([
    ["too few", ["ক"]],
    ["too many", ["ক", "খ", "গ"]],
    ["not an array", "কখ"],
    ["a non-string entry", ["ক", 7]],
  ])("rejects a mismatched texts shape (%s)", async (_label, texts) => {
    const { client } = setup(async () => json({ ok: true, texts, provider: "gemini", model: "m" }));
    expect((await client.improve([blob("a"), blob("b")])).ok).toBe(false);
  });

  it("passes the AbortSignal to fetch and reports an abort as an error", async () => {
    const controller = new AbortController();
    const { client, fetchMock } = setup(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const result = await client.improve([blob("x")], controller.signal);
    expect(callArgs(fetchMock)[1].signal).toBe(controller.signal);
    expect(result.ok).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });

  it("makes no request when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, fetchMock } = setup(async () => json({}));
    const result = await client.improve([blob("x")], controller.signal);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});

describe("available", () => {
  it("is true for {ok:true, available:true}, with the Bearer token and the signal", async () => {
    const controller = new AbortController();
    const { client, fetchMock } = setup(async () => json({ ok: true, available: true }));
    expect(await client.available(controller.signal)).toBe(true);
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("/api/ocr/improve");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
    expect(init.signal).toBe(controller.signal);
  });

  it("is false for available:false", async () => {
    const { client } = setup(async () => json({ ok: true, available: false }));
    expect(await client.available()).toBe(false);
  });

  it("is false for a 401", async () => {
    const { client } = setup(async () =>
      json({ ok: false, error: { code: "AUTHENTICATION_ERROR", message: "Sign in." } }, 401),
    );
    expect(await client.available()).toBe(false);
  });

  it("is false for a network error", async () => {
    const { client } = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await client.available()).toBe(false);
  });

  it("is false, with no request, when there is no token", async () => {
    const { client, fetchMock } = setup(async () => json({ ok: true, available: true }), null);
    expect(await client.available()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
