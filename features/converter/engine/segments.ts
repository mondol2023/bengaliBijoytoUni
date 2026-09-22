/**
 * The converted output, cut into the runs a renderer can mark individually.
 *
 * `unicodeText` is one string, which is all the product needed while an
 * unmapped sequence could only ever be shown as the raw bytes it already is.
 * Filling one from the resolution store needs more: the exact span that was
 * filled has to be markable, and `UnmappedDetail.positions` indexes the
 * *source* text, not the output. So the cut is taken from the token array,
 * where the two are still aligned.
 *
 * One segment per unmapped token, and consecutive mapped tokens merged. The
 * per-token granularity is not an arbitrary choice: `validateTokens` keys
 * `unmappedDetails` on a single token's `legacy`, and `occurrence.ts` stores
 * that same string as `failedSequence`, so one unmapped token is exactly the
 * unit a stored resolution is keyed by. Merging a run of them would produce
 * a span no stored resolution could ever match.
 *
 * ## Normalization, and why the join is checked rather than assumed
 *
 * `unicodeText` is `NFC(assemble(tokens))` — normalized once, over the whole
 * string. These segments are normalized individually, and per-segment NFC
 * equals whole-string NFC only when nothing composes across a segment
 * boundary. Every boundary here sits against an unmapped token, which is a
 * CP1252 byte no rule matched, and Bengali combining marks do not compose
 * with Latin — so in this codebase they agree.
 *
 * "In this codebase they agree" is not a guarantee, so it is verified rather
 * than trusted: if the segments do not rejoin to `unicodeText` exactly, the
 * whole output is returned as one mapped segment. That costs the fallback
 * marking and nothing else — the reader sees today's behaviour, raw bytes
 * and a warning, instead of text spliced against offsets we could not
 * confirm.
 */
import type { Token } from "../encodings/types";
import { normalizeText } from "./normalize";

export interface OutputSegment {
  /** NFC-normalized output for this run. */
  readonly text: string;
  /** True when this run is legacy bytes no rule matched, passed through. */
  readonly unmapped: boolean;
  /** The run's first token's offset in the post-hygiene source text. */
  readonly sourceIndex: number;
}

/**
 * Cuts `tokens` into segments whose texts rejoin to `unicodeText`.
 *
 * `unicodeText` is passed in rather than recomputed so this function can
 * check itself against the engine's actual output instead of against its own
 * idea of it.
 */
export function buildOutputSegments(
  tokens: readonly Token[],
  unicodeText: string,
): OutputSegment[] {
  const segments: OutputSegment[] = [];
  let mapped: { parts: string[]; sourceIndex: number } | null = null;

  const flush = () => {
    if (mapped === null) return;
    segments.push({
      text: normalizeText(mapped.parts.join("")),
      unmapped: false,
      sourceIndex: mapped.sourceIndex,
    });
    mapped = null;
  };

  for (const token of tokens) {
    if (token.unmapped) {
      flush();
      segments.push({
        text: normalizeText(token.unicode),
        unmapped: true,
        sourceIndex: token.sourceIndex,
      });
      continue;
    }
    if (mapped === null) mapped = { parts: [], sourceIndex: token.sourceIndex };
    mapped.parts.push(token.unicode);
  }
  flush();

  if (joinSegments(segments) !== unicodeText) {
    return [{ text: unicodeText, unmapped: false, sourceIndex: 0 }];
  }
  return segments;
}

/** The text these segments render to, which must equal the engine's `unicodeText`. */
export function joinSegments(segments: readonly OutputSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}
