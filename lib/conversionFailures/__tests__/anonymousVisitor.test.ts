import { beforeEach, describe, expect, it } from "vitest";
import {
  ANONYMOUS_VISITOR_STORAGE_KEY,
  __resetAnonymousVisitorForTests,
  getAnonymousVisitorId,
  isAnonymousVisitorId,
} from "../anonymousVisitor";
import type { StorageLike } from "../outbox";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const ID_A = "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b";
const ID_B = "6fa459ea-ee8a-4ca4-894e-db77e160355e";

describe("getAnonymousVisitorId", () => {
  beforeEach(() => __resetAnonymousVisitorForTests());

  it("creates an id once and returns the same one on every later call", () => {
    const storage = memoryStorage();
    const ids = [ID_A, ID_B];
    const first = getAnonymousVisitorId(storage, () => ids.shift()!);
    const second = getAnonymousVisitorId(storage, () => ids.shift()!);

    expect(first).toBe(ID_A);
    expect(second).toBe(ID_A);
    expect(storage.data.get(ANONYMOUS_VISITOR_STORAGE_KEY)).toBe(ID_A);
  });

  it("keeps the id across a fresh module state, because it lives in storage", () => {
    const storage = memoryStorage();
    getAnonymousVisitorId(storage, () => ID_A);
    __resetAnonymousVisitorForTests();
    expect(getAnonymousVisitorId(storage, () => ID_B)).toBe(ID_A);
  });

  it("replaces a stored value that is not a valid id", () => {
    const storage = memoryStorage();
    storage.setItem(ANONYMOUS_VISITOR_STORAGE_KEY, "not-a-uuid");
    expect(getAnonymousVisitorId(storage, () => ID_B)).toBe(ID_B);
    expect(storage.data.get(ANONYMOUS_VISITOR_STORAGE_KEY)).toBe(ID_B);
  });

  it("falls back to one id for the page's lifetime when storage throws", () => {
    const ids = [ID_A, ID_B];
    const first = getAnonymousVisitorId(throwingStorage, () => ids.shift()!);
    const second = getAnonymousVisitorId(throwingStorage, () => ids.shift()!);
    expect(first).toBe(ID_A);
    expect(second).toBe(ID_A);
  });

  it("falls back the same way when there is no storage at all", () => {
    expect(getAnonymousVisitorId(null, () => ID_A)).toBe(ID_A);
    expect(getAnonymousVisitorId(null, () => ID_B)).toBe(ID_A);
  });
});

describe("isAnonymousVisitorId", () => {
  it("accepts a v4 uuid and rejects anything else", () => {
    expect(isAnonymousVisitorId(ID_A)).toBe(true);
    expect(isAnonymousVisitorId("anonymous1")).toBe(false);
    expect(isAnonymousVisitorId("")).toBe(false);
    expect(isAnonymousVisitorId(42)).toBe(false);
    expect(isAnonymousVisitorId(`${ID_A}x`)).toBe(false);
  });
});
