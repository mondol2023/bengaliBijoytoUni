/**
 * `scripts/retentionPeriods.mjs` restates the retention periods for
 * plain-Node scripts. This is the mechanism that stops the copy drifting
 * from `retention.ts`, which is the source of truth.
 *
 * Without it the failure is quiet and bad: the backfill would stamp
 * `expireAt` using one period while the app stamps new documents with
 * another, and the only symptom would be old rows expiring on a schedule
 * nobody chose.
 */
import { describe, expect, it } from "vitest";
import { RETENTION_COLLECTIONS, RETENTION_DAYS } from "../retention";
// A plain .mjs data module with no type declarations, which is the point:
// the backfill script runs under bare `node` and cannot load TypeScript
// cleanly. `allowJs` in tsconfig.json means tsc still infers its shape here,
// so a renamed export fails the type check as well as this test.
import * as scriptPeriods from "../../../scripts/retentionPeriods.mjs";

describe("scripts/retentionPeriods.mjs matches retention.ts", () => {
  it("lists the same collections", () => {
    expect(scriptPeriods.RETENTION_COLLECTIONS).toStrictEqual([...RETENTION_COLLECTIONS]);
  });

  it("uses the same period for every collection", () => {
    expect(scriptPeriods.RETENTION_DAYS).toStrictEqual({ ...RETENTION_DAYS });
  });

  it("covers every collection the source of truth defines", () => {
    // A collection added to `retention.ts` and forgotten here would make the
    // backfill silently skip it.
    for (const collection of RETENTION_COLLECTIONS) {
      expect(scriptPeriods.RETENTION_DAYS[collection]).toBe(RETENTION_DAYS[collection]);
    }
  });
});
