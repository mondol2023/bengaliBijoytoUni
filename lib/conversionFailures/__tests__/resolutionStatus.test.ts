/**
 * Two things are being pinned: the derivation itself, and the claim in
 * `docs/phase-4-resolution-store.md` that only a human can produce
 * `accepted`. The second is a property of who writes `reviewDecision`, so
 * the test for it scans shipped sources rather than calling a function.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESOLUTION_STATUSES,
  isAcceptedResolution,
  resolutionStatusOf,
  type ReviewableResolution,
} from "../resolutionStatus";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

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
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(full);
    }
  }
  return files;
}

function at(status: ReviewableResolution["status"], reviewDecision: ReviewableResolution["reviewDecision"]) {
  return { status, reviewDecision } satisfies ReviewableResolution;
}

describe("resolutionStatusOf", () => {
  it("reports accepted only for an explicit accepted decision", () => {
    expect(resolutionStatusOf(at("reviewed", "accepted"))).toBe("accepted");
    expect(isAcceptedResolution(at("reviewed", "accepted"))).toBe(true);
  });

  it("reports rejected for an explicit rejected decision", () => {
    expect(resolutionStatusOf(at("reviewed", "rejected"))).toBe("rejected");
    expect(isAcceptedResolution(at("reviewed", "rejected"))).toBe(false);
  });

  it("treats everything without a decision as unverified", () => {
    // Including `failed` and `pending`. The conservative direction: the only
    // status that unlocks serving is one a person had to create.
    for (const status of ["pending", "completed", "failed", "reviewed"] as const) {
      expect(resolutionStatusOf(at(status, null)), status).toBe("unverified");
      expect(isAcceptedResolution(at(status, null)), status).toBe(false);
    }
  });

  it("does not let a completed status imply acceptance", () => {
    // The trap this guards: `status: "completed"` means the provider
    // answered, not that anyone agreed with the answer.
    expect(resolutionStatusOf(at("completed", null))).toBe("unverified");
  });

  it("exposes exactly the three statuses the design names", () => {
    expect([...RESOLUTION_STATUSES]).toStrictEqual(["unverified", "accepted", "rejected"]);
  });
});

/**
 * An object-literal assignment to `reviewDecision`, not a read and not a
 * type declaration. The trailing comma is what separates the two: a type
 * writes `reviewDecision: "accepted" | "rejected" | null;`, an assignment
 * writes `reviewDecision: input.decision,`.
 */
const WRITES_REVIEW_DECISION = /reviewDecision:\s*(input\.decision|decision|"accepted"|"rejected")\s*,/;

describe("only the admin review path can produce an accepted resolution", () => {
  it("writes reviewDecision in exactly one shipped module", () => {
    const writers: string[] = [];
    for (const dir of ["lib", "app", "features", "hooks", "components"]) {
      for (const file of listSources(path.join(REPO_ROOT, dir))) {
        if (WRITES_REVIEW_DECISION.test(readFileSync(file, "utf8"))) {
          writers.push(path.relative(REPO_ROOT, file).split(path.sep).join("/"));
        }
      }
    }
    expect(writers).toStrictEqual(["lib/ai/reviewConversionResolution.ts"]);
  });

  it("sees the tree it claims to", () => {
    // Guards the assertion above from passing because the scan found nothing.
    expect(listSources(path.join(REPO_ROOT, "lib")).length).toBeGreaterThan(20);
    expect(statSync(path.join(REPO_ROOT, "lib", "ai", "reviewConversionResolution.ts")).isFile()).toBe(true);
  });
});
