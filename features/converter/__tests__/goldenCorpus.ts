/**
 * Discovery and comparison for the golden corpus — kept out of the test file
 * so the harness itself can be tested against synthetic fixtures. A runner
 * that only executes once real documents arrive is a runner nobody has ever
 * seen work.
 *
 * See `__tests__/golden/README.md` for the file convention.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface GoldenCase {
  /** The fixture's base name, used as the test name. */
  name: string;
  encodingId: string;
  legacyPath: string;
  expectedPath: string;
}

const LEGACY_SUFFIX = ".legacy.txt";
const EXPECTED_SUFFIX = ".expected.txt";

/**
 * `<name>.<encodingId>.legacy.txt` paired with `<name>.<encodingId>.expected.txt`.
 * A legacy file with no expected file is an error rather than a skip: a
 * document dropped in and forgotten would otherwise look like a passing
 * corpus.
 */
export function discoverGoldenCases(directory: string): { cases: GoldenCase[]; unpaired: string[] } {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return { cases: [], unpaired: [] };
  }

  const cases: GoldenCase[] = [];
  const unpaired: string[] = [];

  for (const entry of entries.sort()) {
    if (!entry.endsWith(LEGACY_SUFFIX)) continue;
    const stem = entry.slice(0, -LEGACY_SUFFIX.length);
    const expectedName = `${stem}${EXPECTED_SUFFIX}`;
    if (!entries.includes(expectedName)) {
      unpaired.push(entry);
      continue;
    }
    const lastDot = stem.lastIndexOf(".");
    const encodingId = lastDot === -1 ? "" : stem.slice(lastDot + 1);
    cases.push({
      name: stem,
      encodingId,
      legacyPath: path.join(directory, entry),
      expectedPath: path.join(directory, expectedName),
    });
  }

  return { cases, unpaired };
}

/**
 * Normalizes only what a text editor can change without anyone meaning to:
 * a BOM, CRLF line endings, and a trailing newline. Everything else is
 * compared exactly — a golden corpus whose comparison trims whitespace
 * cannot catch a reorder bug that moves a ZWJ.
 */
export function normalizeFixtureText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\n$/, "");
}

export function readFixture(filePath: string): string {
  return normalizeFixtureText(readFileSync(filePath, "utf8"));
}

/** A short, printable description of where two strings first diverge. */
export function describeFirstDifference(actual: string, expected: string): string {
  const limit = Math.min(actual.length, expected.length);
  let index = 0;
  while (index < limit && actual[index] === expected[index]) index++;

  if (index === limit && actual.length === expected.length) return "identical";

  const context = 24;
  const from = Math.max(0, index - context);
  const codePointAt = (value: string) => {
    const point = value.codePointAt(index);
    return point === undefined ? "end of string" : `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;
  };

  return [
    `first difference at index ${index}`,
    `  expected: ${JSON.stringify(expected.slice(from, index + context))} (${codePointAt(expected)})`,
    `  actual:   ${JSON.stringify(actual.slice(from, index + context))} (${codePointAt(actual)})`,
  ].join("\n");
}
