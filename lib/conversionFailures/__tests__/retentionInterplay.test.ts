/**
 * Phase 4 item 6: an accepted resolution must not be deleted by TTL.
 *
 * That is a property of four separate things staying true at once, so each
 * is asserted separately rather than trusting the one that is easiest to
 * check:
 *
 *  1. `aiResolutions` is not a retention collection, in the app or in the
 *     script that restates the list;
 *  2. `aiResolutionSchema` has no `expireAt`, so zod strips one even if a
 *     caller passes it;
 *  3. no shipped module writes `expireAt` anywhere near that collection;
 *  4. if a TTL is ever added, `mayExpireResolution` says which documents it
 *     may touch.
 *
 * Firestore expires a document only when a TTL policy names a field of
 * `Timestamp` type on it. Every one of these checks is therefore about the
 * field's absence, which is the only thing this repository can control — the
 * policy itself is a console step (`docs/data-retention.md` §3).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiResolutionSchema } from "@/lib/firebase/schemas";
import {
  RETENTION_COLLECTIONS,
  RETENTION_EXEMPT_COLLECTIONS,
  mayExpireResolution,
  retentionFields,
} from "../retention";
import { RETENTION_COLLECTIONS as SCRIPT_COLLECTIONS } from "../../../scripts/retentionPeriods.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function listSources(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "__tests__"].includes(entry.name)) continue;
      files.push(...listSources(full));
    } else if (
      [".ts", ".tsx"].includes(path.extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(full);
    }
  }
  return files;
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

describe("aiResolutions is outside retention, and says so", () => {
  it("is not one of the collections that get an expireAt", () => {
    expect([...RETENTION_COLLECTIONS]).toStrictEqual(["conversionFailures", "failurePatterns"]);
    expect([...RETENTION_COLLECTIONS]).not.toContain("aiResolutions");
  });

  it("is absent from the script's copy of the list too", () => {
    // The script stamps documents in whatever it is given. A list that grew
    // on only one side would be a silent divergence.
    expect([...SCRIPT_COLLECTIONS]).toStrictEqual([...RETENTION_COLLECTIONS]);
  });

  it("records why it is exempt, not merely that it is", () => {
    expect(Object.keys(RETENTION_EXEMPT_COLLECTIONS)).toStrictEqual(["aiResolutions"]);
    expect(RETENTION_EXEMPT_COLLECTIONS.aiResolutions.length).toBeGreaterThan(80);
  });

  it("still stamps the two collections that do expire", () => {
    // Non-vacuity: the checks above would also pass if retention had been
    // turned off altogether.
    const now = new Date("2026-09-22T00:00:00.000Z");
    expect(retentionFields("conversionFailures", now).expireAt.getTime()).toBeGreaterThan(now.getTime());
    expect(retentionFields("failurePatterns", now).expireAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("the schema cannot carry an expireAt", () => {
  const record = {
    patternId: "pattern-1",
    encodingId: "bijoy",
    failedSequence: "Av",
    lookupKey: "key-1",
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: "v1",
    engineVersion: "1.0.0",
    rulesHash: "rules-abc",
    candidateConversion: "আ",
    reasoningSummary: null,
    confidence: "high" as const,
    alternativeCandidates: [],
    isCertain: true,
    rawResponse: null,
    hitCount: 0,
    lastUsedAt: null,
    status: "reviewed" as const,
    reviewDecision: "accepted" as const,
    reviewedBy: "admin-1",
    reviewedAt: "2026-09-01T00:00:00.000Z",
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  };

  it("strips an expireAt a caller tries to write", () => {
    // Every write to this collection goes through `aiResolutionSchema.parse`
    // (`lib/ai/resolveConversionFailure.ts`, `reviewConversionResolution.ts`),
    // and zod drops unknown keys — so this is not advice, it is the write
    // path's actual behaviour.
    const parsed = aiResolutionSchema.parse({ ...record, expireAt: new Date("2026-01-01") });
    expect("expireAt" in parsed).toBe(false);
  });

  it("does not declare the field at all", () => {
    expect(Object.keys(aiResolutionSchema.shape)).not.toContain("expireAt");
  });
});

describe("nothing writes expireAt into aiResolutions", () => {
  it("names the field only in known modules, none of which is a writer for this collection", () => {
    // `retention.ts` defines it; `disclosure.ts` explains it to a reader.
    // Every retention write goes through `retentionFields()`, which is the
    // next test's subject. The shared counters stamp their own `expireAt` on
    // their own documents (`costCap.ts` and `sharedRateLimit.ts` compute
    // it, `counterStore.ts` declares it, `sharedCounter.ts` writes it) — and `sharedCounter.ts`
    // refuses any collection outside `SHARED_COUNTER_COLLECTIONS`, which its
    // own test pins as excluding `aiResolutions`. The staging probe route
    // stamps one on its own synthetic `stagingProbes` document and writes no
    // other collection. Any other file appearing here is a new place the
    // field is being handled by hand, and worth a look.
    const mentions: string[] = [];
    for (const dir of ["lib", "app", "features", "hooks", "components"]) {
      for (const file of listSources(path.join(REPO_ROOT, dir))) {
        if (/expireAt/.test(readFileSync(file, "utf8"))) mentions.push(relative(file));
      }
    }
    expect(mentions.sort()).toStrictEqual([
      "app/api/admin/firebase-identity/route.ts",
      "lib/ai/costCap.ts",
      "lib/conversionFailures/retention.ts",
      "lib/firebase/sharedCounter.ts",
      "lib/privacy/disclosure.ts",
      "lib/security/counterStore.ts",
      "lib/security/sharedRateLimit.ts",
    ]);
  });

  it("does not mention it in the same module as the resolutions collection, except to write the other two", () => {
    // `lib/firebase/conversionFailures.ts` holds all three collections, so
    // the file-level check above cannot separate them. This one reads the
    // actual call sites.
    const source = readFileSync(
      path.join(REPO_ROOT, "lib", "firebase", "conversionFailures.ts"),
      "utf8",
    );
    const stamped = [...source.matchAll(/retentionFields\("([^"]+)"/g)].map((match) => match[1]);
    expect(stamped.length).toBeGreaterThan(0);
    expect(new Set(stamped)).toStrictEqual(new Set(["conversionFailures", "failurePatterns"]));
  });

  it("sees the tree it claims to", () => {
    expect(listSources(path.join(REPO_ROOT, "lib")).length).toBeGreaterThan(20);
  });
});

describe("mayExpireResolution", () => {
  it("exempts an accepted resolution", () => {
    expect(mayExpireResolution({ reviewDecision: "accepted" })).toBe(false);
  });

  it("does not exempt a rejected or unreviewed one", () => {
    expect(mayExpireResolution({ reviewDecision: "rejected" })).toBe(true);
    expect(mayExpireResolution({ reviewDecision: null })).toBe(true);
  });
});
