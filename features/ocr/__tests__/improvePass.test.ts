import { describe, expect, it, vi } from "vitest";
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { AppError, Result } from "@/lib/errors/types";
import type { ItemOutcome } from "../engine/orchestrator";
import { pickImproveTargets, runImprovePass } from "../fallback/improvePass";
import type { ImproveState } from "../fallback/improvePass";
import type { ImproveReading } from "../fallback/improveClient";

const CHECK = { needed: true, reason: "low-confidence" } as const;
const done = (id: string, confidence: number, needed = true, text = "x"): ItemOutcome => ({
  status: "done",
  id,
  text,
  confidence,
  lang: "ben",
  words: [],
  fallback: needed ? CHECK : { needed: false },
  imagePixels: 100,
});

describe("pickImproveTargets", () => {
  it("skips unreadable, failed and lines that did not need a second look", () => {
    const outcomes: ItemOutcome[] = [
      { status: "unreadable", id: "u" },
      { status: "failed", id: "f", error: AppErrors.unknown("x") },
      done("fine", 95, false),
      done("weak", 40),
    ];
    expect(pickImproveTargets(outcomes, 10)).toEqual(["weak"]);
  });

  it("orders by ascending confidence, empty output first, and honours max", () => {
    const outcomes = [done("a", 60), done("b", 30), done("blank", 80, true, ""), done("c", 45)];
    expect(pickImproveTargets(outcomes, 10)).toEqual(["blank", "b", "c", "a"]);
    expect(pickImproveTargets(outcomes, 2)).toEqual(["blank", "b"]);
  });

  it("returns nothing for max 0", () => {
    expect(pickImproveTargets([done("a", 10)], 0)).toEqual([]);
  });
});

const blob = (id: string, bytes = 100) => new Blob([id.padEnd(bytes, ".")], { type: "image/jpeg" });
const reading = (texts: string[]): Result<ImproveReading> => ok({ texts, provider: "gemini", model: "m" });
const fail = (error: AppError): Result<ImproveReading> => err(error);

interface Setup {
  ids: string[];
  results: Array<() => Promise<Result<ImproveReading>>>;
  missing?: string[];
  signal?: AbortSignal;
  onUpdate?: (id: string, state: ImproveState) => void;
}

function setup({ ids, results, missing = [], signal, onUpdate }: Setup) {
  const calls: Array<{ blobs: Blob[]; signal: AbortSignal | undefined }> = [];
  const updates: Array<[string, ImproveState]> = [];
  const improve = vi.fn(async (blobs: readonly Blob[], callSignal?: AbortSignal) => {
    calls.push({ blobs: [...blobs], signal: callSignal });
    const next = results[calls.length - 1];
    if (!next) throw new Error("unexpected extra improve call");
    return next();
  });
  const run = () =>
    runImprovePass(ids, {
      client: { improve },
      loadCrop: async (id) => (missing.includes(id) ? null : blob(id)),
      onUpdate: (id, state) => {
        updates.push([id, state]);
        onUpdate?.(id, state);
      },
      signal,
    });
  return { run, improve, calls, updates };
}

const texts = (ids: string[]) => ids.map((id) => `t-${id}`);
const settled = (updates: Array<[string, ImproveState]>) =>
  Object.fromEntries(updates.map(([id, state]) => [id, state.status]));

describe("runImprovePass", () => {
  it("sends 6 targets as 4 then 2, one batch at a time, and maps text by position", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    let firstResolved = false;
    let secondStartedEarly = false;
    const { run, calls, updates } = setup({
      ids,
      results: [
        async () => {
          await Promise.resolve();
          firstResolved = true;
          return reading(texts(ids.slice(0, 4)));
        },
        async () => {
          secondStartedEarly = !firstResolved;
          return reading(texts(ids.slice(4)));
        },
      ],
    });
    const outcome = await run();

    expect(outcome).toEqual({ stoppedBy: "done" });
    expect(calls.map((call) => call.blobs.length)).toEqual([4, 2]);
    expect(secondStartedEarly).toBe(false);
    const doneUpdates = updates.filter(([, state]) => state.status === "done");
    expect(doneUpdates.map(([id]) => id)).toEqual(ids);
    expect(doneUpdates[4]?.[1]).toEqual({ status: "done", text: "t-e", provider: "gemini", model: "m" });
    // Each id's blob went out in the position its text came back in.
    expect(await calls[0]?.blobs[2]?.text()).toMatch(/^c/);
  });

  it("marks a null crop failed without a request and still sends the rest", async () => {
    const { run, calls, updates } = setup({
      ids: ["a", "big", "c"],
      missing: ["big"],
      results: [async () => reading(["t-a", "t-c"])],
    });
    expect(await run()).toEqual({ stoppedBy: "done" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.blobs).toHaveLength(2);
    expect(updates).toContainEqual(["big", { status: "failed", message: "This line is too large to send." }]);
    expect(settled(updates)).toEqual({ a: "done", big: "failed", c: "done" });
  });

  it("keeps the local reading of a line the AI found no text in, and still improves the rest", async () => {
    const { run, updates } = setup({
      ids: ["a", "logo", "c"],
      results: [async () => reading(["t-a", "", "t-c"])],
    });
    expect(await run()).toEqual({ stoppedBy: "done" });
    expect(updates).toContainEqual(["logo", { status: "failed", message: "The AI found no text in this image." }]);
    expect(settled(updates)).toEqual({ a: "done", logo: "failed", c: "done" });
  });

  it("makes no request at all when nothing is sendable", async () => {
    const { run, improve, updates } = setup({ ids: ["a"], missing: ["a"], results: [] });
    expect(await run()).toEqual({ stoppedBy: "done" });
    expect(improve).not.toHaveBeenCalled();
    expect(settled(updates)).toEqual({ a: "failed" });
  });

  it("stops on the first AUTHENTICATION_ERROR, never sends batch 2, and fails the rest", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const { run, calls, updates } = setup({
      ids,
      results: [async () => fail(AppErrors.authentication("Session expired.")), async () => reading([])],
    });
    expect(await run()).toEqual({ stoppedBy: "auth" });
    expect(calls).toHaveLength(1);
    const byId = Object.fromEntries(updates);
    expect(byId.a).toEqual({ status: "failed", message: "Session expired." });
    expect(byId.e).toEqual({ status: "failed", message: "Sign in again to continue." });
    expect(byId.f).toEqual({ status: "failed", message: "Sign in again to continue." });
    expect(Object.keys(byId)).toHaveLength(6);
  });

  it("stops with rate-limit and fails the unsent lines with the server's message", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const { run, calls, updates } = setup({
      ids,
      results: [async () => fail(AppErrors.rateLimit("Slow down.", { details: { retryAfterSeconds: 30 } }))],
    });
    expect(await run()).toEqual({ stoppedBy: "rate-limit" });
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(updates).e).toEqual({ status: "failed", message: "Slow down." });
  });

  it.each([
    ["NOT_FOUND_ERROR", () => AppErrors.notFound("Off.")],
    ["AUTHORIZATION_ERROR", () => AppErrors.authorization("Not allowed.")],
  ])("stops with unavailable on %s", async (_code, make) => {
    const ids = ["a", "b", "c", "d", "e"];
    const { run, calls } = setup({ ids, results: [async () => fail(make())] });
    expect(await run()).toEqual({ stoppedBy: "unavailable" });
    expect(calls).toHaveLength(1);
  });

  it("stops with errors after two failed batches in a row", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const { run, calls, updates } = setup({
      ids,
      results: [
        async () => fail(AppErrors.unknown("Bad answer.")),
        async () => fail(AppErrors.unknown("Bad answer.")),
        async () => reading([]),
      ],
    });
    expect(await run()).toEqual({ stoppedBy: "errors" });
    expect(calls).toHaveLength(2);
    expect(Object.fromEntries(updates).i).toEqual({ status: "failed", message: "Bad answer." });
    expect(updates).toHaveLength(9);
  });

  it("keeps going after one failed batch followed by a success", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const { run, calls, updates } = setup({
      ids,
      results: [
        async () => fail(AppErrors.unknown("Bad answer.")),
        async () => reading(texts(ids.slice(4, 8))),
        async () => fail(AppErrors.unknown("Bad answer.")),
      ],
    });
    expect(await run()).toEqual({ stoppedBy: "done" });
    expect(calls).toHaveLength(3);
    expect(settled(updates)).toMatchObject({ a: "failed", e: "done", i: "failed" });
  });

  it("stops between batches when aborted: no more requests, no more updates", async () => {
    const controller = new AbortController();
    const ids = ["a", "b", "c", "d", "e", "f"];
    const { run, calls, updates } = setup({
      ids,
      signal: controller.signal,
      results: [async () => reading(texts(ids.slice(0, 4))), async () => reading([])],
      onUpdate: (id) => {
        if (id === "d") controller.abort();
      },
    });
    expect(await run()).toEqual({ stoppedBy: "aborted" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(updates.map(([id]) => id)).toEqual(["a", "b", "c", "d"]);
  });

  it("drops the answer that arrives after an abort", async () => {
    const controller = new AbortController();
    const { run, updates } = setup({
      ids: ["a", "b"],
      signal: controller.signal,
      results: [
        async () => {
          controller.abort();
          return reading(["t-a", "t-b"]);
        },
      ],
    });
    expect(await run()).toEqual({ stoppedBy: "aborted" });
    expect(updates).toEqual([]);
  });

  it("drops a failure that arrives after an abort", async () => {
    const controller = new AbortController();
    const { run, updates } = setup({
      ids: ["a"],
      signal: controller.signal,
      results: [
        async () => {
          controller.abort();
          return fail(AppErrors.unknown("Cancelled."));
        },
      ],
    });
    expect(await run()).toEqual({ stoppedBy: "aborted" });
    expect(updates).toEqual([]);
  });

  it("does nothing when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, improve, updates } = setup({ ids: ["a"], signal: controller.signal, results: [] });
    expect(await run()).toEqual({ stoppedBy: "aborted" });
    expect(improve).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("fails ids past the per-job cap instead of leaving them running", async () => {
    const ids = Array.from({ length: 42 }, (_, index) => `c${index}`);
    const { run, calls, updates } = setup({
      ids,
      results: Array.from({ length: 10 }, (_, batch) => async () =>
        reading(texts(ids.slice(batch * 4, batch * 4 + 4))),
      ),
    });
    expect(await run()).toEqual({ stoppedBy: "done" });
    expect(calls.reduce((sum, call) => sum + call.blobs.length, 0)).toBe(40);
    const byId = Object.fromEntries(updates);
    expect(byId.c40).toEqual({ status: "failed", message: "Too many lines for one pass. This one kept its local reading." });
    expect(Object.keys(byId)).toHaveLength(42);
  });
});
