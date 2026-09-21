/**
 * The conversion hot path stays pure.
 *
 * A cache is exactly the kind of thing that ends up inside
 * `convertLegacyText` on the commit after it is introduced — it looks like a
 * free speedup. It is not free here: conversion runs per debounced keystroke
 * in the browser, and a cache lookup makes it depend on storage that is
 * allowed to fail, allowed to be stale, and allowed to be slow. Worse, a
 * stale hit would show a user Bengali text the current engine would not
 * produce.
 *
 * Asserted rather than written down, because a comment does not fail a build.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertLegacyText } from "@/features/converter/engine/pipeline";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function listShippedSources(dir: string): string[] {
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
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      files.push(...listShippedSources(full));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function repoRelative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

/** Comments explaining the boundary are not violations of it. */
function withoutComments(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const ENGINE_FILES = listShippedSources(path.join(REPO_ROOT, "features/converter/engine"));
const ENCODING_FILES = listShippedSources(path.join(REPO_ROOT, "features/converter/encodings"));
const CONVERSION_PATH_FILES = [...ENGINE_FILES, ...ENCODING_FILES];

describe("the scan sees the tree it claims to", () => {
  it("found the engine and the encodings", () => {
    const relative = CONVERSION_PATH_FILES.map(repoRelative);
    expect(relative).toContain("features/converter/engine/pipeline.ts");
    expect(relative).toContain("features/converter/engine/version.ts");
    expect(relative.length).toBeGreaterThan(8);
  });
});

describe("no cache in the conversion hot path", () => {
  it("finds no import of lib/cache under features/converter", () => {
    const offenders = CONVERSION_PATH_FILES.filter((file) => {
      const contents = withoutComments(file);
      return /from\s+["'][^"']*lib\/cache/.test(contents) || /import\(\s*["'][^"']*lib\/cache/.test(contents);
    }).map(repoRelative);
    expect(offenders, "convertLegacyText must stay pure — no cache lookup, no I/O").toStrictEqual([]);
  });

  it("keeps convertLegacyText synchronous", () => {
    // A synchronous function cannot await a cache, a fetch, or a Firestore
    // read. This is the cheapest possible proof that the hot path does no
    // I/O, and it fails the moment someone makes room for some.
    expect(convertLegacyText.constructor.name).toBe("Function");
    const result = convertLegacyText("Avwg", "bijoy");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("finds no fetch or Firestore access in the engine", () => {
    const offenders: string[] = [];
    for (const file of ENGINE_FILES) {
      const contents = withoutComments(file);
      if (/\bfetch\s*\(/.test(contents)) offenders.push(`${repoRelative(file)} (fetch)`);
      if (/lib\/firebase/.test(contents)) offenders.push(`${repoRelative(file)} (firebase)`);
    }
    expect(offenders).toStrictEqual([]);
  });
});
