/**
 * Step 2 of the lookup order: turning the cached snapshot into the
 * in-memory map `runConversion` reads.
 *
 * Separate from `runConversion.ts` on purpose. This is the half that can do
 * I/O, and keeping it in its own module is what makes "the typing path
 * never awaits" checkable by reading the imports rather than by reading the
 * control flow — `runConversion` cannot await a snapshot it cannot reach.
 *
 * `fetchKnownPatterns` already returns the stale copy on any failure and
 * `null` rather than throwing, so there is no error path to add here: a
 * snapshot that never arrives yields `NO_RESOLUTIONS`, and a conversion
 * with no fallbacks is a correct conversion.
 */
import {
  fetchKnownPatterns,
  type FetchKnownPatternsOptions,
} from "@/lib/conversionFailures/knownPatternsClient";
import { NO_RESOLUTIONS, resolutionMapFrom, type ResolutionSource } from "./runConversion";

export type LoadResolutionSourceOptions = FetchKnownPatternsOptions;

/**
 * Fetches the snapshot for one encoding and builds its map. Called once
 * when the encoding is chosen, never per keystroke.
 */
export async function loadResolutionSource(
  options: LoadResolutionSourceOptions,
): Promise<ResolutionSource> {
  const snapshot = await fetchKnownPatterns(options);
  if (snapshot === null) return NO_RESOLUTIONS;
  return resolutionMapFrom(snapshot, options.encodingId);
}
