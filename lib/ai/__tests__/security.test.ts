/**
 * Enforces the Phase 5 security requirements that can't be caught by a
 * normal unit test: that the server-only guard actually throws in a
 * browser-like environment, and that no client-reachable source directory
 * references a provider API key or imports a provider module directly.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertServerOnly } from "../assertServerOnly";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
/** Everything a browser bundle can plausibly pull code from — deliberately excludes lib/ai and app/api (server-only). */
const CLIENT_REACHABLE_DIRS = ["app", "components", "features", "hooks"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith("__tests__")) continue;
      files.push(...listSourceFiles(fullPath));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      // Server-only route handlers are allowed to reference the registry in a later phase;
      // Phase 5 wires nothing in yet, so excluding api routes here is inert, not a loophole.
      if (fullPath.includes(`${path.sep}api${path.sep}`)) continue;
      files.push(fullPath);
    }
  }
  return files;
}

describe("assertServerOnly", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when window is undefined (Node/Vitest/server)", () => {
    expect(() => assertServerOnly("test-module")).not.toThrow();
  });

  it("throws when window is defined (simulated browser)", () => {
    vi.stubGlobal("window", {});
    expect(() => assertServerOnly("test-module")).toThrow(/server-only/i);
  });
});

describe("provider modules enforce the server-only boundary at import time", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("throws importing lib/ai/providers/gemini in a simulated browser", async () => {
    vi.stubGlobal("window", {});
    await expect(import("../providers/gemini")).rejects.toThrow(/server-only/i);
  });

  it("throws importing lib/ai/providers/openai in a simulated browser", async () => {
    vi.stubGlobal("window", {});
    await expect(import("../providers/openai")).rejects.toThrow(/server-only/i);
  });

  it("throws importing lib/ai/registry in a simulated browser", async () => {
    vi.stubGlobal("window", {});
    await expect(import("../registry")).rejects.toThrow(/server-only/i);
  });

  it("throws importing lib/ai/resolveConversionFailure in a simulated browser", async () => {
    vi.stubGlobal("window", {});
    await expect(import("../resolveConversionFailure")).rejects.toThrow(/server-only/i);
  });

  it("throws importing lib/ai/reviewConversionResolution in a simulated browser", async () => {
    vi.stubGlobal("window", {});
    await expect(import("../reviewConversionResolution")).rejects.toThrow(/server-only/i);
  });
});

describe("no client-reachable source references a provider API key or imports a provider module", () => {
  const existingDirs = CLIENT_REACHABLE_DIRS.map((dir) => path.join(REPO_ROOT, dir)).filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });

  it("finds no GEMINI_API_KEY / OPENAI_API_KEY reference outside lib/ai and server-only api routes", () => {
    for (const dir of existingDirs) {
      for (const file of listSourceFiles(dir)) {
        const contents = readFileSync(file, "utf8");
        expect(contents, `${file} must not reference GEMINI_API_KEY`).not.toContain("GEMINI_API_KEY");
        expect(contents, `${file} must not reference OPENAI_API_KEY`).not.toContain("OPENAI_API_KEY");
      }
    }
  });

  it("finds no direct import of lib/ai/providers/* from client-reachable code", () => {
    for (const dir of existingDirs) {
      for (const file of listSourceFiles(dir)) {
        const contents = readFileSync(file, "utf8");
        expect(contents, `${file} must not import a provider module directly`).not.toMatch(
          /from\s+["'].*lib\/ai\/providers/,
        );
      }
    }
  });
});

describe("the deterministic conversion engine has no AI dependency", () => {
  it("no file under features/converter/engine imports lib/ai", () => {
    const engineDir = path.join(REPO_ROOT, "features", "converter", "engine");
    let files: string[];
    try {
      files = listSourceFiles(engineDir);
    } catch {
      files = [];
    }
    for (const file of files) {
      const contents = readFileSync(file, "utf8");
      expect(contents, `${file} must not import lib/ai`).not.toMatch(/from\s+["'].*lib\/ai/);
    }
  });
});
