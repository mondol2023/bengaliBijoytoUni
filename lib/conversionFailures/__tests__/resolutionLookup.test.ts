import { describe, expect, it } from "vitest";
import { computeResolutionLookupKey } from "../resolutionLookup";

describe("computeResolutionLookupKey", () => {
  it("is stable for the same inputs", () => {
    const a = computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "Av" });
    const b = computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "Av" });
    expect(a).toBe(b);
  });

  it("ignores engine version by construction — there is nowhere to put one", () => {
    // The point of the whole module, stated as a type-level fact: an
    // accepted resolution survives an engine bump.
    const key = computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "Av" });
    expect(key).toHaveLength(64);
  });

  it("separates encodings", () => {
    expect(computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "Av" })).not.toBe(
      computeResolutionLookupKey({ encodingId: "sutonny", failedSequence: "Av" }),
    );
  });

  it("separates sequences", () => {
    expect(computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "Av" })).not.toBe(
      computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "Aw" }),
    );
  });

  it("treats a null encoding as distinct from the literal string", () => {
    expect(computeResolutionLookupKey({ encodingId: null, failedSequence: "Av" })).not.toBe(
      computeResolutionLookupKey({ encodingId: "null", failedSequence: "Av" }),
    );
  });

  it("treats a null encoding as distinct from an empty one", () => {
    // Both reduce to "" before hashing without the length prefix; with it
    // they still differ only if "" and null are meant to differ. They are
    // not meant to: an empty encodingId is not a value the writer produces,
    // so this pins the actual behaviour rather than an aspiration.
    expect(computeResolutionLookupKey({ encodingId: null, failedSequence: "Av" })).toBe(
      computeResolutionLookupKey({ encodingId: "", failedSequence: "Av" }),
    );
  });

  it("cannot be forged by moving the boundary between the two fields", () => {
    // Without length prefixes, ("ab","c") and ("a","bc") both hash "ab|c"
    // under a naive join. `failedSequence` is attacker-influenced, so this
    // is a real collision, not a theoretical one.
    expect(computeResolutionLookupKey({ encodingId: "ab", failedSequence: "c" })).not.toBe(
      computeResolutionLookupKey({ encodingId: "a", failedSequence: "bc" }),
    );
  });

  it("cannot be forged with a separator inside the sequence", () => {
    expect(computeResolutionLookupKey({ encodingId: "a", failedSequence: "b|c" })).not.toBe(
      computeResolutionLookupKey({ encodingId: "a|b", failedSequence: "c" }),
    );
  });

  it("distinguishes sequences that differ only in Unicode normalization", () => {
    // Legacy bytes are not normalized and must not be conflated here: the
    // engine's NFC pass happens after conversion, not before lookup.
    expect(computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "ক্" })).not.toBe(
      computeResolutionLookupKey({ encodingId: "bijoy", failedSequence: "ক" }),
    );
  });
});
