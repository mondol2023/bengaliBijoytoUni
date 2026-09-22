/**
 * The wire shape of the published resolutions: not just "this sequence is
 * known to fail" but "here is what it should have been".
 *
 * Phase 4 item 5. Deliberately schema-only. The rule that decides *which*
 * stored resolutions become these — `./selectResolutions.ts` — needs the
 * validator, and the validator needs every encoding's rule table. This file
 * is reached from `./knownPatternsClient.ts` and therefore from a browser
 * bundle, so keeping the two apart means a page that only parses a snapshot
 * does not pull the tables in to do it.
 *
 * An unreviewed entry carries its label *in the payload*, not in a component
 * that might forget to add it — which is why `label` is part of the schema
 * rather than a rendering detail.
 */
import { z } from "zod";
import type { Bilingual } from "@/lib/privacy/disclosure";

/**
 * The label an unverified entry carries. Bilingual for the same reason the
 * privacy copy is: it is shown, not switched between, and a reader of either
 * language must be told the same thing. **Draft wording, awaiting review.**
 */
export const AI_UNVERIFIED_LABEL: Bilingual = {
  en: "AI-suggested, unverified",
  bn: "এআই-প্রস্তাবিত, যাচাই করা হয়নি",
};

export const knownResolutionSchema = z.object({
  /** The legacy sequence this resolves. Matches a `failedSequence` in `patterns`. */
  failedSequence: z.string().min(1),
  candidateConversion: z.string().min(1),
  /** `accepted` means a named admin accepted it; `unverified` means only the validator has. */
  verification: z.enum(["accepted", "unverified"]),
  /** Non-null exactly when `verification` is `unverified`. */
  label: z.object({ en: z.string().min(1), bn: z.string().min(1) }).nullable(),
  /** Metadata, not part of the lookup: the engine this candidate was produced against. */
  engineVersion: z.string().min(1),
});
export type KnownResolution = z.infer<typeof knownResolutionSchema>;

/**
 * How many resolutions a snapshot may carry, independent of how many
 * patterns it carries. Lower than the pattern limit because each entry is
 * two pieces of text rather than one short sequence, and the whole snapshot
 * is cached in `localStorage` by `knownPatternsClient.ts`.
 */
export const KNOWN_RESOLUTIONS_DEFAULT_LIMIT = 25;

/**
 * A hard ceiling on the serialized resolutions, applied after the top-N cut.
 * The cut alone is not a bound: 25 entries of a 200-character sequence and a
 * 1,000-character candidate is ~30 KB of text before escaping, and the
 * browser cache holds up to 8 encodings' snapshots. 64 KiB keeps the worst
 * case comfortably inside a `localStorage` budget and keeps the response
 * small enough to be worth fetching on page load.
 */
export const KNOWN_RESOLUTIONS_MAX_BYTES = 64 * 1024;

/** The stored fields selection reads. A structural subset of `AiResolution`. */
export interface StoredResolution {
  readonly encodingId: string | null;
  readonly failedSequence: string;
  readonly candidateConversion: string | null;
  readonly engineVersion: string;
  readonly status: "pending" | "completed" | "failed" | "reviewed";
  readonly reviewDecision: "accepted" | "rejected" | null;
  readonly hitCount: number;
  readonly lastUsedAt: string | null;
  /** Only a tiebreaker here, so the order is total and the ETag is stable. */
  readonly lookupKey: string;
}
