/**
 * The draft behind the "this is wrong" control on a marked segment.
 *
 * No new endpoint and no new collection: `POST /api/feedback` already takes
 * a `wrong_conversion` category with `encodingId`, `sampleInput` and
 * `sampleOutput`, is open to anonymous callers and is rate-limited. All this
 * module does is fill that existing form in from the segment the reader is
 * pointing at, so a report arrives with the sequence and the substitution
 * rather than "one of the letters was wrong".
 *
 * A report is evidence for an admin and nothing more. Nothing here carries a
 * status, a verdict, a resolution id or a count: the resolution moves only
 * when a human acts on it in the admin UI.
 */
import { FEEDBACK_LIMITS } from "@/lib/feedback/limits";
import type { RenderSegment } from "./runConversion";

/** Exactly the fields the feedback route accepts, and no others. */
export interface FallbackReportDraft {
  readonly category: "wrong_conversion";
  readonly encodingId: string;
  readonly sampleInput: string;
  readonly sampleOutput: string;
  readonly message: string;
}

/** Legacy bytes are often invisible or confusable on screen; code points are not. */
export function describeSequence(sequence: string): string {
  const points: string[] = [];
  for (const character of sequence) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    points.push(`U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return points.length === 0 ? sequence : `${sequence} (${points.join(" ")})`;
}

const ORIGIN = {
  fallback_accepted: "a stored resolution an admin accepted",
  fallback_unverified: "an unverified AI suggestion",
} as const;

/**
 * Null for anything but a filled segment. A clean run has no fallback to be
 * wrong about, and an unresolved one was never filled in — the conversion
 * warnings already report that case.
 */
export function fallbackReportDraft(
  encodingId: string,
  segment: Pick<RenderSegment, "text" | "state" | "failedSequence">,
): FallbackReportDraft | null {
  if (segment.state !== "fallback_accepted" && segment.state !== "fallback_unverified") return null;
  if (segment.failedSequence === null || segment.failedSequence.length === 0) return null;

  const message = [
    "This filled-in text looks wrong.",
    "",
    `Sequence: ${describeSequence(segment.failedSequence)}`,
    `Filled in as: ${segment.text}`,
    `Source: ${ORIGIN[segment.state]}.`,
    "",
    "What it should be instead:",
  ]
    .join("\n")
    .slice(0, FEEDBACK_LIMITS.maxMessageLength);

  return {
    category: "wrong_conversion",
    encodingId,
    sampleInput: segment.failedSequence.slice(0, FEEDBACK_LIMITS.maxSampleLength),
    sampleOutput: segment.text.slice(0, FEEDBACK_LIMITS.maxSampleLength),
    message,
  };
}
