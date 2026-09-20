/**
 * Bridges the mismatch flagged in `docs/conversion-failure-pipeline.md` §7.1:
 * `ConversionResolution.confidence` (`lib/ai/types.ts`) is
 * `"low" | "medium" | "high" | null`, while the Firestore `aiResolutions`
 * schema's `confidence` (`lib/firebase/schemas.ts`) is
 * `"high" | "medium" | "low" | "unknown"` — no `null`. This is the one place
 * that reconciles them, so no call site ever needs an `as` cast.
 *
 * Semantics: a domain `null` means "the provider gave no assessable
 * confidence" — a real, meaningful outcome (see `types.ts`), not an error.
 * Firestore's `"unknown"` is defined to mean exactly that, so the mapping is
 * a straight relabeling with no information lost.
 */
import type { ResolutionConfidence } from "./types";

/** Matches `aiResolutionSchema.confidence` in `lib/firebase/schemas.ts` exactly. */
export type FirestoreResolutionConfidence = "high" | "medium" | "low" | "unknown";

export function mapResolutionConfidence(confidence: ResolutionConfidence | null): FirestoreResolutionConfidence {
  switch (confidence) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    case null:
      return "unknown";
  }
}
