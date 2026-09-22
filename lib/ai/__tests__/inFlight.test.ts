/**
 * De-duplication of concurrent identical work. The interesting cases are all
 * about timing, so each test controls when the shared promise settles rather
 * than relying on the event loop to be in a particular state.
 */
import { describe, expect, it, vi } from "vitest";
import { createInFlightMap } from "../inFlight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createInFlightMap", () => {
  it("runs the work once for concurrent callers on the same key", async () => {
    const gate = deferred<string>();
    const work = vi.fn(() => gate.promise);
    const map = createInFlightMap<string>();

    const a = map.run("k", work);
    const b = map.run("k", work);
    expect(work).toHaveBeenCalledTimes(1);

    gate.resolve("one answer");
    expect(await a).toBe("one answer");
    expect(await b).toBe("one answer");
  });

  it("keeps different keys apart", async () => {
    const work = vi.fn(async () => "x");
    const map = createInFlightMap<string>();
    await Promise.all([map.run("a", work), map.run("b", work)]);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("is a de-duplicator, not a cache", async () => {
    // A second call after the first settles must do real work against
    // whatever the state is then.
    const work = vi.fn(async () => "x");
    const map = createInFlightMap<string>();
    await map.run("k", work);
    await map.run("k", work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("gives a joiner the same rejection, not a swallowed one", async () => {
    const gate = deferred<string>();
    const map = createInFlightMap<string>();
    const a = map.run("k", () => gate.promise);
    const b = map.run("k", () => gate.promise);

    gate.reject(new Error("provider down"));
    await expect(a).rejects.toThrow("provider down");
    await expect(b).rejects.toThrow("provider down");
  });

  it("frees the key after a rejection, so a retry is possible", async () => {
    const map = createInFlightMap<string>();
    await expect(
      map.run("k", async () => {
        throw new Error("first");
      }),
    ).rejects.toThrow("first");
    expect(map.size()).toBe(0);
    await expect(map.run("k", async () => "second")).resolves.toBe("second");
  });

  it("does not leave a key behind when the work throws synchronously", async () => {
    const map = createInFlightMap<string>();
    await expect(
      map.run("k", () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    expect(map.size()).toBe(0);
  });

  it("reports how many calls are in flight", async () => {
    const gate = deferred<string>();
    const map = createInFlightMap<string>();
    expect(map.size()).toBe(0);
    const running = map.run("k", () => gate.promise);
    expect(map.size()).toBe(1);
    gate.resolve("done");
    await running;
    expect(map.size()).toBe(0);
  });

  it("does not delete a key a later run has taken over", async () => {
    // Guards the identity check in the cleanup: without it, a slow first
    // run settling after a second one started would remove the second's
    // entry and let a third run duplicate it.
    const first = deferred<string>();
    const second = deferred<string>();
    const map = createInFlightMap<string>();

    const a = map.run("k", () => first.promise);
    first.resolve("first");
    await a;

    const work = vi.fn(() => second.promise);
    const b = map.run("k", work);
    map.run("k", work);
    expect(work).toHaveBeenCalledTimes(1);
    second.resolve("second");
    await b;
  });
});
