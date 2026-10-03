import { describe, expect, it, vi } from "vitest";
import { sendOutboxBatch, KEEPALIVE_BODY_LIMIT } from "../outboxSend";
import type { OutboxAuth, OutboxBatch } from "../outbox";

const VISITOR = "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b";

function batch(auth: OutboxAuth, failures: unknown[] = [{ failedSequence: "Av" }]): OutboxBatch<unknown> {
  return { id: "b1", createdAt: 0, auth, failures };
}

function setup({ uid = null as string | null, status = 200, throws = false } = {}) {
  const fetchImpl = vi.fn(async () => {
    if (throws) throw new TypeError("Failed to fetch");
    return new Response("{}", { status });
  });
  const deps = {
    currentUid: () => uid,
    getIdToken: vi.fn(async () => "token-123"),
    visitorId: () => VISITOR,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  const call = () => {
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    return {
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
      keepalive: init.keepalive,
    };
  };
  return { deps, fetchImpl, call };
}

describe("sendOutboxBatch", () => {
  it("sends an anonymous batch with its own visitor id and no token", async () => {
    const { deps, call } = setup({ uid: "now-signed-in" });
    const outcome = await sendOutboxBatch(batch({ kind: "anonymous", visitorId: VISITOR }), deps);

    expect(outcome).toBe("delivered");
    expect(call().headers.Authorization).toBeUndefined();
    expect(call().body.anonymousVisitorId).toBe(VISITOR);
    expect(deps.getIdToken).not.toHaveBeenCalled();
  });

  it("sends a user batch with a token when that user is still signed in", async () => {
    const { deps, call } = setup({ uid: "u1" });
    await sendOutboxBatch(batch({ kind: "user", uid: "u1" }), deps);

    expect(call().headers.Authorization).toBe("Bearer token-123");
    expect(call().body).not.toHaveProperty("anonymousVisitorId");
  });

  it("sends a user batch unattributed when someone else is signed in now", async () => {
    const { deps, call } = setup({ uid: "u2" });
    await sendOutboxBatch(batch({ kind: "user", uid: "u1" }), deps);

    expect(call().headers.Authorization).toBeUndefined();
    expect(call().body).not.toHaveProperty("anonymousVisitorId");
  });

  it("resolves an unknown batch to whoever is signed in at send time", async () => {
    const signedIn = setup({ uid: "u1" });
    await sendOutboxBatch(batch({ kind: "unknown" }), signedIn.deps);
    expect(signedIn.call().headers.Authorization).toBe("Bearer token-123");

    const signedOut = setup();
    await sendOutboxBatch(batch({ kind: "unknown" }), signedOut.deps);
    expect(signedOut.call().headers.Authorization).toBeUndefined();
    expect(signedOut.call().body.anonymousVisitorId).toBe(VISITOR);
  });

  it("maps responses to outcomes", async () => {
    const cases: Array<[number, string]> = [
      [200, "delivered"],
      [400, "rejected"],
      [413, "rejected"],
      [408, "retry"],
      [429, "retry"],
      [500, "retry"],
      [503, "retry"],
    ];
    for (const [status, expected] of cases) {
      const { deps } = setup({ status });
      expect(await sendOutboxBatch(batch({ kind: "unknown" }), deps), String(status)).toBe(expected);
    }
  });

  it("retries when the network fails", async () => {
    const { deps } = setup({ throws: true });
    expect(await sendOutboxBatch(batch({ kind: "unknown" }), deps)).toBe("retry");
  });

  it("uses keepalive only for bodies the browser will accept with it", async () => {
    const small = setup();
    await sendOutboxBatch(batch({ kind: "unknown" }), small.deps);
    expect(small.call().keepalive).toBe(true);

    const large = setup();
    const failures = [{ contextBefore: "x".repeat(KEEPALIVE_BODY_LIMIT) }];
    await sendOutboxBatch(batch({ kind: "unknown" }, failures), large.deps);
    expect(large.call().keepalive).toBe(false);
  });
});
