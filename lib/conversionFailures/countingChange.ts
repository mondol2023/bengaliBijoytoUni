/**
 * The one place that records what `occurrenceCount` means and when its
 * meaning changed.
 *
 * Why this exists as code rather than only as a paragraph in a document: the
 * number is on screen in the admin UI, and a stored aggregate carries no
 * marker saying which counting rule produced it. Someone comparing "this
 * month against last month" is comparing two different quantities and has no
 * way to see that from the chart. A note in `docs/` is only read by whoever
 * goes looking; this is read by whoever looks at the number.
 *
 * Every claim below is checked against its source by
 * `lib/conversionFailures/__tests__/countingChange.test.ts`.
 */
import { CONVERSION_FAILURE_LIMITS } from "./limits";

/**
 * The commit that changed the unit. Short SHA, as `git log --oneline` prints
 * it: `620aacd feat(reporting): batch failure reports as count deltas`.
 */
export const COUNTING_CHANGE_COMMIT = "620aacd";

/** Author date of that commit, ISO date, from `git log -1 --format=%ad --date=short`. */
export const COUNTING_CHANGE_DATE = "2026-09-21";

/**
 * Whether the change has reached the data the admin UI is reading.
 *
 * `620aacd` lives on `feat/font-conversion-hardening` and is not on `main`,
 * so at the time of writing every stored `occurrenceCount` was produced by
 * the old rule. Flip this when the branch merges and deploys — the copy
 * below changes with it, because "counts will change from here on" and
 * "counts before this date mean something else" are different warnings and
 * showing the wrong one is worse than showing neither.
 */
export const COUNTING_CHANGE_SHIPPED = false;

/** What one unit of `occurrenceCount` meant before `COUNTING_CHANGE_COMMIT`. */
export const COUNTING_RULE_BEFORE =
  "one browser session that hit the failure at least once, however many times it occurred in that session";

/** What one unit means after it. */
export const COUNTING_RULE_AFTER =
  "one occurrence, counted as the high-water mark seen in a single conversion, per pattern per session";

/**
 * The line shown beside the number in the admin UI. Short enough to sit
 * under a stat tile; the detail is in `docs/conversion-failure-pipeline.md`
 * §3.2.1, which this points at.
 */
export const COUNTING_CHANGE_NOTE = COUNTING_CHANGE_SHIPPED
  ? `Unit changed in ${COUNTING_CHANGE_COMMIT} (${COUNTING_CHANGE_DATE}): counts before that date are sessions, after it occurrences. Do not compare across it.`
  : `Counts sessions, not occurrences. ${COUNTING_CHANGE_COMMIT} changes the unit to occurrences and has not shipped — totals will jump when it does.`;

/** Where the full explanation lives, for the link beside the note. */
export const COUNTING_CHANGE_DOC = "docs/conversion-failure-pipeline.md";

/**
 * The per-request ceiling, restated here because the note's credibility
 * depends on it: an unbounded client-supplied delta would make the new unit
 * meaningless rather than merely different.
 */
export const COUNTING_MAX_PER_REPORT = CONVERSION_FAILURE_LIMITS.maxOccurrenceCount;
