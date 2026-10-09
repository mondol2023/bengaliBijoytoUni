import { describe, expect, it } from "vitest";
import {
  COMPARE_PREFILL_KEY,
  COMPARE_PREFILL_MAX_AGE_MS,
  stashComparePrefill,
  takeComparePrefill,
  type PrefillStorage,
} from "../prefill";

function memoryStorage(initial: Record<string, string> = {}): PrefillStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("stashComparePrefill / takeComparePrefill", () => {
  it("hands the stashed text over once, then it is gone", () => {
    const storage = memoryStorage();
    expect(stashComparePrefill(storage, "নং ৪৫/২০২৫", 1_000)).toBe(true);
    expect(takeComparePrefill(storage, 2_000)).toBe("নং ৪৫/২০২৫");
    expect(takeComparePrefill(storage, 2_000)).toBeNull();
    expect(storage.data.has(COMPARE_PREFILL_KEY)).toBe(false);
  });

  it("keeps the text byte-for-byte (no trimming, no normalising)", () => {
    const storage = memoryStorage();
    const text = "  line one\n\nline two  \n";
    stashComparePrefill(storage, text, 0);
    expect(takeComparePrefill(storage, 0)).toBe(text);
  });

  it("returns null and touches nothing when the key is absent", () => {
    const storage = memoryStorage();
    expect(takeComparePrefill(storage, 0)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("refuses to stash text that is empty or only whitespace", () => {
    const storage = memoryStorage();
    expect(stashComparePrefill(storage, "", 0)).toBe(false);
    expect(stashComparePrefill(storage, " \n\t", 0)).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it("ignores, and clears, a stash older than the max age", () => {
    const storage = memoryStorage();
    stashComparePrefill(storage, "old", 0);
    expect(takeComparePrefill(storage, COMPARE_PREFILL_MAX_AGE_MS + 1)).toBeNull();
    expect(storage.data.has(COMPARE_PREFILL_KEY)).toBe(false);
  });

  it("accepts a stash exactly at the max age", () => {
    const storage = memoryStorage();
    stashComparePrefill(storage, "edge", 0);
    expect(takeComparePrefill(storage, COMPARE_PREFILL_MAX_AGE_MS)).toBe("edge");
  });

  it("ignores, and clears, a stash dated in the future", () => {
    const storage = memoryStorage();
    stashComparePrefill(storage, "from the future", 10_000);
    expect(takeComparePrefill(storage, 0)).toBeNull();
    expect(storage.data.has(COMPARE_PREFILL_KEY)).toBe(false);
  });

  it.each([
    ["not json", "{nope"],
    ["a bare string", JSON.stringify("hello")],
    ["wrong version", JSON.stringify({ v: 2, text: "x", at: 0 })],
    ["text not a string", JSON.stringify({ v: 1, text: 5, at: 0 })],
    ["empty text", JSON.stringify({ v: 1, text: "", at: 0 })],
    ["missing timestamp", JSON.stringify({ v: 1, text: "x" })],
  ])("treats %s as nothing to prefill and clears it", (_name, raw) => {
    const storage = memoryStorage({ [COMPARE_PREFILL_KEY]: raw });
    expect(takeComparePrefill(storage, 0)).toBeNull();
    expect(storage.data.has(COMPARE_PREFILL_KEY)).toBe(false);
  });

  it("reports false when storage refuses the write (quota, private mode)", () => {
    const storage: PrefillStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(stashComparePrefill(storage, "big", 0)).toBe(false);
  });

  it("returns null when storage throws on read", () => {
    const storage: PrefillStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    expect(takeComparePrefill(storage, 0)).toBeNull();
  });

  it("returns null when storage is unavailable", () => {
    expect(takeComparePrefill(null, 0)).toBeNull();
    expect(stashComparePrefill(null, "x", 0)).toBe(false);
  });

  it("a second stash replaces the first", () => {
    const storage = memoryStorage();
    stashComparePrefill(storage, "first", 0);
    stashComparePrefill(storage, "second", 1);
    expect(takeComparePrefill(storage, 2)).toBe("second");
  });
});
