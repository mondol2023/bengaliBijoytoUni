import { describe, expect, it } from "vitest";
import { mapFirebaseAuthError } from "../AuthProvider";

describe("mapFirebaseAuthError", () => {
  const cases: Array<[string, string]> = [
    ["auth/invalid-email", "That email address doesn't look right."],
    ["auth/user-not-found", "No account found with that email."],
    ["auth/wrong-password", "Incorrect password."],
    ["auth/invalid-credential", "Incorrect email or password."],
    ["auth/email-already-in-use", "An account already exists with that email — try signing in instead."],
    ["auth/weak-password", "Choose a password with at least 6 characters."],
    ["auth/popup-closed-by-user", "Sign-in was cancelled."],
    ["auth/network-request-failed", "Network error — check your connection and try again."],
    ["auth/too-many-requests", "Too many attempts — wait a moment and try again."],
  ];

  for (const [code, message] of cases) {
    it(`maps ${code} to a specific, safe message`, () => {
      const result = mapFirebaseAuthError({ code });
      expect(result).toEqual({ code: "AUTHENTICATION_ERROR", message });
    });
  }

  it("falls back to a generic message for an unrecognized Firebase code", () => {
    const result = mapFirebaseAuthError({ code: "auth/some-new-code-not-in-the-table" });
    expect(result).toEqual({ code: "AUTHENTICATION_ERROR", message: "Sign-in failed. Please try again." });
  });

  it("falls back to a generic message when the cause has no code at all", () => {
    expect(mapFirebaseAuthError(new Error("boom"))).toEqual({
      code: "AUTHENTICATION_ERROR",
      message: "Sign-in failed. Please try again.",
    });
    expect(mapFirebaseAuthError(null)).toEqual({
      code: "AUTHENTICATION_ERROR",
      message: "Sign-in failed. Please try again.",
    });
    expect(mapFirebaseAuthError("a plain string")).toEqual({
      code: "AUTHENTICATION_ERROR",
      message: "Sign-in failed. Please try again.",
    });
  });
});
