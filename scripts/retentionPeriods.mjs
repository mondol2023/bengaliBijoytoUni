/**
 * The retention periods, restated for plain-Node scripts.
 *
 * `lib/conversionFailures/retention.ts` is the source of truth and the app
 * reads it directly. A `.mjs` script importing that `.ts` file does work
 * under Node's type stripping, but only with a MODULE_TYPELESS_PACKAGE_JSON
 * warning printed above the script's own output — noise at the top of a
 * destructive operation, where an operator should be reading counts, not
 * deciding which warnings to ignore.
 *
 * So the numbers are restated here and
 * `lib/conversionFailures/__tests__/retentionPeriods.script.test.ts` fails
 * the suite if the two ever disagree. The duplication is real; it is just
 * the kind that cannot survive a commit.
 */

export const RETENTION_COLLECTIONS = ["conversionFailures", "failurePatterns"];

export const RETENTION_DAYS = {
  conversionFailures: 90,
  failurePatterns: 365,
};
