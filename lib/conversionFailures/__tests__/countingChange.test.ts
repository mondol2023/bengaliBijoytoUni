/**
 * The counting note is only worth showing if it is true. These tests hold it
 * to its sources: the clamp it quotes, the document it points at, and the
 * agreement between the shipped flag and the sentence that flag selects.
 *
 * What they cannot check is whether `COUNTING_CHANGE_SHIPPED` still matches
 * reality after a merge. Nothing in the repository knows what is deployed.
 * The test below at least fails if the flag is flipped and the copy is not
 * regenerated.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COUNTING_CHANGE_COMMIT,
  COUNTING_CHANGE_DATE,
  COUNTING_CHANGE_DOC,
  COUNTING_CHANGE_NOTE,
  COUNTING_CHANGE_SHIPPED,
  COUNTING_MAX_PER_REPORT,
  COUNTING_RULE_AFTER,
  COUNTING_RULE_BEFORE,
} from "../countingChange";
import { CONVERSION_FAILURE_LIMITS } from "../limits";

const repoRoot = resolve(__dirname, "../../..");

describe("the occurrence-count change note matches its sources", () => {
  it("quotes the clamp the writer actually applies", () => {
    expect(COUNTING_MAX_PER_REPORT).toBe(CONVERSION_FAILURE_LIMITS.maxOccurrenceCount);
  });

  it("points at a document that exists and names the commit", () => {
    // A note whose reference has been renamed away is a dead end at exactly
    // the moment someone is trying to understand the number.
    const path = resolve(repoRoot, COUNTING_CHANGE_DOC);
    expect(existsSync(path), `${COUNTING_CHANGE_DOC} does not exist`).toBe(true);
    expect(readFileSync(path, "utf8")).toContain(COUNTING_CHANGE_COMMIT);
  });

  it("uses a short SHA and an ISO date", () => {
    expect(COUNTING_CHANGE_COMMIT).toMatch(/^[0-9a-f]{7,40}$/);
    expect(COUNTING_CHANGE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("describes two different units", () => {
    // If these ever read the same there is no change to warn about, and the
    // note should be deleted rather than left saying nothing.
    expect(COUNTING_RULE_BEFORE).not.toBe(COUNTING_RULE_AFTER);
    expect(COUNTING_RULE_BEFORE).toContain("session");
    expect(COUNTING_RULE_AFTER).toContain("occurrence");
  });
});

describe("the note shown is the one the shipped flag selects", () => {
  it("warns about a future jump while unshipped, and about a boundary once shipped", () => {
    expect(COUNTING_CHANGE_NOTE).toContain(COUNTING_CHANGE_COMMIT);
    if (COUNTING_CHANGE_SHIPPED) {
      expect(COUNTING_CHANGE_NOTE).toContain(COUNTING_CHANGE_DATE);
      expect(COUNTING_CHANGE_NOTE).toContain("Do not compare across it");
    } else {
      expect(COUNTING_CHANGE_NOTE).toContain("has not shipped");
      expect(COUNTING_CHANGE_NOTE).not.toContain("Do not compare across it");
    }
  });
});
