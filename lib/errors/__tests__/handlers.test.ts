import { describe, expect, it } from "vitest";
import { AppErrors } from "../types";
import type { AppError } from "../types";
import { failResponder, isAppError, statusForAppError, toAppError, toSafeResponse } from "../handlers";

describe("toAppError", () => {
  it("passes one of our own AppErrors through untouched", () => {
    const original = AppErrors.notFound("No such pattern.");
    expect(toAppError(original)).toBe(original);
  });

  it("does not mistake a third-party {code,message} error for an AppError", () => {
    // The exact shape a FirebaseError / Firestore gRPC error has. Duck-typing
    // on `"code" in cause` alone used to pass this straight through, which
    // sent an internal message to the client as a "user-safe" one and left
    // `statusForAppError` with no matching case.
    const firestoreError = {
      code: "permission-denied",
      message: "Missing or insufficient permissions on /users/abc.",
    };
    const normalized = toAppError(firestoreError, "Could not load users.");

    expect(normalized.code).toBe("UNKNOWN_ERROR");
    expect(normalized.message).toBe("Could not load users.");
    expect(toSafeResponse(normalized).message).not.toContain("permissions on /users/abc");
    // The original is kept for the server log, where `toSafeResponse` strips it.
    expect(normalized.debug).toBe(firestoreError);
  });

  it("normalizes a thrown Error, which also has a `message` but no `code`", () => {
    const normalized = toAppError(new Error("ECONNREFUSED 10.0.0.1:443"));
    expect(normalized.code).toBe("UNKNOWN_ERROR");
    expect(normalized.message).toBe("Something went wrong.");
  });

  it.each([null, undefined, "boom", 42])("normalizes the non-object %p", (cause) => {
    expect(toAppError(cause).code).toBe("UNKNOWN_ERROR");
  });
});

describe("isAppError", () => {
  it("accepts every AppErrors constructor's output", () => {
    for (const make of Object.values(AppErrors)) {
      expect(isAppError((make as (m: string) => AppError)("x"))).toBe(true);
    }
  });

  it("rejects a look-alike whose code is not an AppErrorCode", () => {
    expect(isAppError({ code: "auth/invalid-token", message: "…" })).toBe(false);
  });

  it("rejects an object whose code is the right value but the wrong type", () => {
    expect(isAppError({ code: 404, message: "…" })).toBe(false);
  });
});

describe("statusForAppError", () => {
  it("maps every AppErrorCode to a real status, never undefined", () => {
    for (const make of Object.values(AppErrors)) {
      const status = statusForAppError((make as (m: string) => AppError)("x"));
      expect(typeof status).toBe("number");
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });

  it("falls back to 500 for an unrecognized code instead of returning undefined", () => {
    // A switch with no default returns `undefined`, and
    // `Response.json(body, { status: undefined })` sends 200 — an error
    // reported to the client as a success.
    const rogue = { code: "NOT_A_REAL_CODE", message: "…" } as unknown as AppError;
    expect(statusForAppError(rogue)).toBe(500);
  });
});

describe("failResponder", () => {
  it("sends the safe body and the mapped status, never `debug`", async () => {
    const fail = failResponder("api/test");
    const response = fail(AppErrors.authorization("Admin access required.", { debug: "secret-uid-trace" }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: { code: "AUTHORIZATION_ERROR", message: "Admin access required." } });
    expect(JSON.stringify(body)).not.toContain("secret-uid-trace");
  });

  it("sets Retry-After on a rate-limit error so a client or proxy can honor it", async () => {
    const fail = failResponder("api/test");
    const response = fail(AppErrors.rateLimit("Slow down.", { details: { retryAfterSeconds: 42 } }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("sets no Retry-After on anything else", () => {
    const response = failResponder("api/test")(AppErrors.validation("Bad input."));
    expect(response.headers.get("Retry-After")).toBeNull();
  });
});
