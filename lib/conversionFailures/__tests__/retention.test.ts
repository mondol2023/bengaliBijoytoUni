/**
 * Retention is arithmetic plus a type, and both halves are load-bearing:
 * a wrong period keeps data too long, and a wrong *type* keeps it forever,
 * because Firestore's TTL service silently ignores a field that is not a
 * `Timestamp`. A test that only checked the number would pass on a policy
 * that never deletes anything.
 */
import { describe, expect, it } from "vitest";
import {
  RETENTION_COLLECTIONS,
  RETENTION_DAYS,
  computeExpireAt,
  retentionFields,
  retentionFieldsSchema,
} from "../retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-21T12:00:00.000Z");

describe("computeExpireAt", () => {
  it("puts an occurrence exactly its retention period out", () => {
    expect(computeExpireAt("conversionFailures", NOW).toISOString()).toBe(
      new Date(NOW.getTime() + RETENTION_DAYS.conversionFailures * DAY_MS).toISOString(),
    );
  });

  it("puts a pattern exactly its retention period out", () => {
    expect(computeExpireAt("failurePatterns", NOW).toISOString()).toBe(
      new Date(NOW.getTime() + RETENTION_DAYS.failurePatterns * DAY_MS).toISOString(),
    );
  });

  it("is always in the future for every collection", () => {
    for (const collection of RETENTION_COLLECTIONS) {
      expect(computeExpireAt(collection, NOW).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("does not mutate the clock it was handed", () => {
    const now = new Date(NOW);
    computeExpireAt("conversionFailures", now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });

  it("keeps patterns at least as long as the occurrences that feed them", () => {
    // A pattern expiring before its own occurrences would leave occurrence
    // rows with no aggregate to find them by.
    expect(RETENTION_DAYS.failurePatterns).toBeGreaterThanOrEqual(RETENTION_DAYS.conversionFailures);
  });

  it("has a positive whole number of days for every collection", () => {
    for (const collection of RETENTION_COLLECTIONS) {
      expect(Number.isInteger(RETENTION_DAYS[collection])).toBe(true);
      expect(RETENTION_DAYS[collection]).toBeGreaterThan(0);
    }
  });
});

describe("retentionFields", () => {
  it("produces a Date, which the Admin SDK stores as the Timestamp TTL requires", () => {
    // Not a formality: an ISO string here would be written as a string, and
    // a TTL policy skips a non-Timestamp field without erroring.
    expect(retentionFields("conversionFailures", NOW).expireAt).toBeInstanceOf(Date);
  });

  it("carries nothing but expireAt", () => {
    expect(Object.keys(retentionFields("failurePatterns", NOW))).toStrictEqual(["expireAt"]);
  });

  it("rejects a stringified timestamp at the write boundary", () => {
    expect(() => retentionFieldsSchema.parse({ expireAt: NOW.toISOString() })).toThrow();
  });

  it("slides: a later call yields a later expiry for the same collection", () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(retentionFields("failurePatterns", later).expireAt.getTime()).toBeGreaterThan(
      retentionFields("failurePatterns", NOW).expireAt.getTime(),
    );
  });
});
