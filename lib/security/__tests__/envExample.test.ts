/**
 * Guard A: a tracked `.env*.example` file must never carry a real value.
 *
 * These files exist to name the variables a deployment needs, so they are
 * committed on purpose while every sibling `.env*` is gitignored
 * (`.gitignore`: `.env*` with a single `!.env.local.example` exception). That
 * makes them the one place in the tree where a credential can be committed by
 * an ordinary, well-intentioned edit — someone fills in a value to test
 * locally, and `git add` picks it up because this path is exempt from the
 * ignore rule.
 *
 * The check runs over what git actually tracks, not over what is on disk: an
 * untracked `.env.local` holding real values is the correct state and must not
 * fail this test.
 *
 * Nothing here ever prints a matched value. A failure that pasted the
 * credential into CI output would leak it into a log that is usually more
 * widely readable than the branch that caused the failure, so every assertion
 * message carries the file, the variable name, and the value's length only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** `.env.example`, `.env.local.example`, `.env.production.example`, … */
const ENV_EXAMPLE_PATTERN = /(^|\/)\.env[^/]*\.example$/;

/**
 * Tracked files only. `git ls-files` is the authority on "committed", which is
 * the thing this guard is actually about — a directory walk would also pick up
 * an ignored scratch copy and fail on a file no one can leak. Falls back to a
 * walk only if git is unavailable (a source tarball, say), where the worst
 * case is that the guard is stricter than it needs to be.
 */
function listTrackedEnvExamples(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" });
    return out.split("\0").filter((file) => file.length > 0 && ENV_EXAMPLE_PATTERN.test(file));
  } catch {
    return readdirSync(REPO_ROOT).filter((name) => ENV_EXAMPLE_PATTERN.test(name));
  }
}

interface Assignment {
  readonly line: number;
  readonly key: string;
  readonly value: string;
}

/** `KEY=value`, ignoring comments, blank lines, and `export ` prefixes. */
function parseAssignments(contents: string): Assignment[] {
  const assignments: Assignment[] = [];
  contents.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) return;
    const [, key, rawValue] = match;
    assignments.push({ line: index + 1, key, value: rawValue.trim().replace(/^["']|["']$/g, "") });
  });
  return assignments;
}

/**
 * Placeholders a reader is meant to replace. Kept deliberately narrow: the
 * default answer for an example file is an empty value, and every entry here
 * is a shape no real credential has.
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^$/,
  /^<.*>$/,
  /^\.{3}$/,
  /^x+$/i,
  /^(your|my|some)[-_]/i,
  /^(changeme|placeholder|todo|tbd|example|dummy|fake|redacted|unset|none)$/i,
  /^(true|false|\d+)$/i,
  /^https?:\/\/(localhost|127\.0\.0\.1|example\.(com|org))(:\d+)?(\/.*)?$/i,
];

/** Shapes that are a credential no matter what else the value looks like. */
const SECRET_SHAPES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "Google/Firebase API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "PEM private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "service-account client email", pattern: /@[a-z0-9-]+\.iam\.gserviceaccount\.com/i },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
];

/** Never includes the value itself — see the module doc. */
function describeAssignment(file: string, assignment: Assignment, why: string): string {
  return `${file}:${assignment.line} ${assignment.key} ${why} (value redacted, length ${assignment.value.length})`;
}

const trackedEnvExamples = listTrackedEnvExamples();

describe("Guard A: tracked .env*.example files carry no real values", () => {
  it("finds at least one tracked .env*.example to check", () => {
    // Without this, deleting or renaming every example file would turn each
    // `it.each` below into zero cases and the guard would pass vacuously.
    expect(trackedEnvExamples.length).toBeGreaterThan(0);
  });

  it("checks only files that exist on disk", () => {
    for (const file of trackedEnvExamples) {
      expect(existsSync(path.join(REPO_ROOT, file)), `${file} is tracked but missing`).toBe(true);
    }
  });

  it("has no assignment holding anything but an empty value or a placeholder", () => {
    const offenders: string[] = [];
    for (const file of trackedEnvExamples) {
      const contents = readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const assignment of parseAssignments(contents)) {
        const isPlaceholder = PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(assignment.value));
        if (!isPlaceholder) offenders.push(describeAssignment(file, assignment, "has a non-placeholder value"));
      }
    }
    expect(offenders, "an example file must ship the variable name, never a value").toStrictEqual([]);
  });

  it("matches no known credential shape, even in comments", () => {
    const offenders: string[] = [];
    for (const file of trackedEnvExamples) {
      const contents = readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const { name, pattern } of SECRET_SHAPES) {
        // Whole-file, not per-assignment: a key pasted into a comment as an
        // "example of the format" leaks exactly as badly as an assigned one.
        if (pattern.test(contents)) offenders.push(`${file} contains a ${name} (value redacted)`);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it("recognizes a filled-in value as a violation", () => {
    // Proves the rule above can actually fail. A guard whose negative case is
    // never exercised is indistinguishable from one whose regexes never match.
    const filled = parseAssignments("GEMINI_API_KEY=AIzaSyA1234567890123456789012345678901234\nEMPTY=\n");
    expect(filled).toHaveLength(2);
    expect(PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(filled[0].value))).toBe(false);
    expect(PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(filled[1].value))).toBe(true);
    expect(SECRET_SHAPES.some(({ pattern }) => pattern.test(filled[0].value))).toBe(true);
  });

  it("names no value in the message it would fail with", () => {
    const message = describeAssignment(".env.example", { line: 3, key: "SECRET", value: "hunter2hunter2" }, "x");
    expect(message).not.toContain("hunter2hunter2");
    expect(message).toContain("SECRET");
    expect(message).toContain("length 14");
  });
});
