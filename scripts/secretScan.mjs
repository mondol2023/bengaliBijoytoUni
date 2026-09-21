#!/usr/bin/env node
/**
 * Secret-hygiene scan over tracked files and, optionally, all of git history.
 *
 * Reports locations and pattern names. It never prints a matched value, and
 * that is the whole point rather than a nicety: the natural way to write this
 * tool is to echo the offending line so a human can judge it, which copies the
 * credential into terminal scrollback and CI logs — usually more widely
 * readable than the branch that leaked it. Output carries the file, the line
 * number, the pattern that matched, and the match's length. That is enough to
 * go look at the file yourself, which is where a real value should be read.
 *
 * Complements `lib/security/__tests__/envExample.test.ts` (Guard A) rather
 * than duplicating it: Guard A runs in the suite on every commit and covers
 * the one file class where a leak is most likely. This is the broad,
 * on-demand sweep — every tracked file, and every blob ever committed,
 * including on branches and in commits no longer reachable from HEAD.
 *
 * Usage, from `convert2uni/`:
 *
 *   node scripts/secretScan.mjs              # tracked files (fast)
 *   node scripts/secretScan.mjs --history    # + every blob in git history
 *   node scripts/secretScan.mjs --json       # machine-readable, still redacted
 *
 * Exits 1 if anything matched, so it can gate CI.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "google-api-key", re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: "pem-private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "service-account-json", re: /"private_key"\s*:/g },
  { name: "service-account-email", re: /[A-Za-z0-9._%-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/g },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g },
  { name: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  {
    name: "assigned-secret-literal",
    re: /(api[_-]?key|apikey|secret|token|password|credential)\s*[:=]\s*["'][^"']{16,}["']/gi,
  },
];

/**
 * Matches that are known-benign and are asserted on elsewhere. Each entry
 * needs a reason, and the reason has to be that the value is not a
 * credential — not that it is inconvenient. Anything matching here is still
 * counted and reported, just not treated as a failure.
 *
 * An entry is a (path, pattern) pair, not a path. Exempting a whole file
 * makes it a permanent blind spot: a real key pasted into it later would be
 * reported as known-benign, by a scanner whose entire job is to notice that.
 * Naming the pattern keeps the exemption to the one match that was actually
 * examined.
 */
const KNOWN_BENIGN = [
  {
    path: "app/api/admin/conversion-failures/[patternId]/resolve/route.test.ts",
    pattern: "assigned-secret-literal",
    reason: "sentinel proving `debug` is stripped from responses",
  },
  {
    path: "app/api/admin/conversion-failures/[patternId]/review/route.test.ts",
    pattern: "assigned-secret-literal",
    reason: "sentinel proving `debug` is stripped from responses",
  },
  {
    path: "lib/security/__tests__/envExample.test.ts",
    pattern: "google-api-key",
    reason: "synthetic sequential-digit key proving Guard A can fail; not a credential",
  },
  {
    path: "lib/conversionFailures/limits.test.ts",
    pattern: "assigned-secret-literal",
    reason: "fake document text proving the privacy bound truncates",
  },
  {
    path: "docs/secret-hygiene.md",
    pattern: "service-account-json",
    reason: "the prose names the JSON key this pattern looks for; there is no value, here or in history",
  },
];

/** Binary-ish blobs produce noise and cannot hold a pasted credential meaningfully. */
const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm)$/i;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** Line number of a match offset, so a human can go read the real value in context. */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function scan(text, location) {
  const findings = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      findings.push({
        location,
        pattern: name,
        line: lineOf(text, match.index),
        // The length only. Never `match[0]`.
        matchLength: match[0].length,
      });
      if (match[0].length === 0) re.lastIndex++;
    }
  }
  return findings;
}

function scanTracked() {
  const files = git(["ls-files", "-z"]).split("\0").filter((f) => f && !SKIP_EXTENSIONS.test(f));
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    scanned++;
    findings.push(...scan(text, file));
  }
  return { findings, scanned };
}

function scanHistory() {
  // Blob -> a path it was once committed at, so a finding points somewhere
  // recognizable. The same blob can appear at several paths; any one of them
  // is enough to go looking.
  const names = new Map();
  for (const entry of git(["rev-list", "--objects", "--all"]).split("\n")) {
    const space = entry.indexOf(" ");
    if (space !== -1) names.set(entry.slice(0, space), entry.slice(space + 1));
  }

  // Every object in the repository in one process, including blobs from
  // commits no longer reachable from any branch. Spawning a `git cat-file`
  // per blob gives the same answer after minutes of process churn on Windows.
  const stream = execFileSync("git", ["cat-file", "--batch-all-objects", "--batch"], {
    maxBuffer: 1024 * 1024 * 1024,
  });

  const findings = [];
  let scanned = 0;
  let offset = 0;
  while (offset < stream.length) {
    const newline = stream.indexOf(0x0a, offset);
    if (newline === -1) break;
    const [sha, type, sizeText] = stream.subarray(offset, newline).toString("utf8").split(" ");
    const size = Number(sizeText);
    if (!Number.isFinite(size)) break;
    const bodyStart = newline + 1;
    offset = bodyStart + size + 1; // git writes a newline after each body
    if (type !== "blob") continue;
    const pathName = names.get(sha) ?? "<unnamed>";
    if (SKIP_EXTENSIONS.test(pathName)) continue;
    scanned++;
    findings.push(
      ...scan(stream.subarray(bodyStart, bodyStart + size).toString("utf8"), `${sha.slice(0, 10)} ${pathName}`),
    );
  }
  return { findings, scanned };
}

const args = new Set(process.argv.slice(2));
const withHistory = args.has("--history");

const tracked = scanTracked();
const history = withHistory ? scanHistory() : { findings: [], scanned: 0 };
const findings = [...tracked.findings, ...history.findings];

const benignFor = (finding) =>
  KNOWN_BENIGN.find(
    (entry) => finding.location.includes(entry.path) && finding.pattern === entry.pattern,
  );
const unexpected = findings.filter((finding) => !benignFor(finding));

if (args.has("--json")) {
  console.log(
    JSON.stringify(
      {
        trackedFilesScanned: tracked.scanned,
        historyBlobsScanned: history.scanned,
        patterns: PATTERNS.map((pattern) => pattern.name),
        total: findings.length,
        unexpected: unexpected.length,
        findings,
      },
      null,
      2,
    ),
  );
} else {
  // The scanned counts are printed so that a clean run is distinguishable from
  // a run that quietly looked at nothing.
  console.log(
    `Scanned ${tracked.scanned} tracked file(s)` +
      (withHistory ? ` and ${history.scanned} history blob(s)` : "") +
      ` against ${PATTERNS.length} patterns.`,
  );
  console.log(`${findings.length} match(es), ${unexpected.length} unexpected.\n`);
  for (const finding of findings) {
    const benign = benignFor(finding);
    const tag = benign ? `known-benign (${benign.reason})` : "UNEXPECTED";
    console.log(`  ${tag}\n    ${finding.location}:${finding.line}  ${finding.pattern}  length=${finding.matchLength}`);
  }
  if (unexpected.length > 0) {
    console.log("\nValues are deliberately not printed. Open each location above to read the value.");
  }
}

process.exit(unexpected.length > 0 ? 1 : 0);
