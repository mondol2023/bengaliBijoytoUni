/**
 * A flag whose default decides whether unreviewed model output reaches
 * users deserves the same treatment as the one guarding paid calls: every
 * way of getting it wrong must land on "off".
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENABLE_FALLBACK_PIPELINE_ENV,
  SERVE_UNVERIFIED_AI_ENV,
  isFallbackPipelineEnabled,
  isServeUnverifiedAiEnabled,
} from "../serveFlags";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Values a dashboard, a shell or a copy-paste can produce that look like
 * "on" to a person and must not be on. A quoted value is the realistic one:
 * Vercel stores what is typed, quotes included, so `"true"` pasted from a
 * `.env` file arrives as six characters.
 */
const ACCIDENTAL = [
  '"true"',
  "'1'",
  "enabled",
  "y",
  "t",
  "2",
  "-1",
  "truee",
  "true​",
  "ｔｒｕｅ",
  "null",
  "undefined",
  "true,false",
];

describe.each([
  [SERVE_UNVERIFIED_AI_ENV, isServeUnverifiedAiEnabled],
  [ENABLE_FALLBACK_PIPELINE_ENV, isFallbackPipelineEnabled],
] as const)("%s: accidental values", (name, read) => {
  it.each(ACCIDENTAL)("%j is off", (raw) => {
    vi.stubEnv(name, raw);
    expect(read()).toBe(false);
  });
});

describe("isServeUnverifiedAiEnabled", () => {
  it("is off when the variable is not set", () => {
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, undefined);
    expect(isServeUnverifiedAiEnabled()).toBe(false);
  });

  it("is off for empty, whitespace and near-misses", () => {
    for (const raw of ["", "   ", "0", "false", "no", "off", "TRUEISH", "yes please", "1 "]) {
      vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, raw);
      expect(isServeUnverifiedAiEnabled(), JSON.stringify(raw)).toBe(raw.trim() === "1");
    }
  });

  it("is on only for the four words it documents, in any case", () => {
    for (const raw of ["1", "true", "TRUE", "Yes", " on "]) {
      vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, raw);
      expect(isServeUnverifiedAiEnabled(), raw).toBe(true);
    }
  });

  it("reads the variable at call time, not at import time", () => {
    // So a deployment that injects environment variables after module
    // evaluation still gets the setting it configured.
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, "true");
    expect(isServeUnverifiedAiEnabled()).toBe(true);
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, "false");
    expect(isServeUnverifiedAiEnabled()).toBe(false);
  });

  it("does not collide with the flag guarding outbound calls", () => {
    expect(SERVE_UNVERIFIED_AI_ENV).toBe("SERVE_UNVERIFIED_AI");
  });

  it("is never set in an environment template the repository ships", () => {
    // Absent or empty only. A template is what a new environment is copied
    // from, so a value here would turn unreviewed serving on by accident.
    const root = path.join(__dirname, "..", "..", "..");
    for (const file of [".env.local.example", ".env.development.local.example"]) {
      const lines = readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
      const entries = lines.filter((line) => /^\s*(export\s+)?SERVE_UNVERIFIED_AI\s*=/.test(line));
      for (const entry of entries) expect(entry, file).toBe(`${SERVE_UNVERIFIED_AI_ENV}=`);
    }
  });

  describe("can never reach a browser bundle", () => {
    // The converter's last line of defence is that this flag is off in every
    // browser (`runConversion` refuses unverified entries client-side). That
    // holds only while Next.js has no way to inline the value. Each test
    // closes one way it could start to.
    const root = path.join(__dirname, "..", "..", "..");

    it("is not a NEXT_PUBLIC_ variable", () => {
      expect(SERVE_UNVERIFIED_AI_ENV.startsWith("NEXT_PUBLIC_")).toBe(false);
    });

    it("is read by a computed key, which Next.js never inlines", () => {
      const source = readFileSync(path.join(__dirname, "..", "serveFlags.ts"), "utf8");
      expect(source).toContain("process.env[SERVE_UNVERIFIED_AI_ENV]");
      expect(source).not.toMatch(/process\.env\.SERVE_UNVERIFIED_AI\b/);
    });

    it("is not forwarded by next.config.ts, whose `env` key inlines into every bundle", () => {
      const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
      expect(config).not.toContain("SERVE_UNVERIFIED_AI");
    });

    it("has no NEXT_PUBLIC_ twin anywhere in the application source", () => {
      // Tests are skipped: they never reach a bundle, and the bundle
      // checker's own test names the twin as a fixture on purpose.
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== "__tests__") walk(full);
          } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            if (readFileSync(full, "utf8").includes("NEXT_PUBLIC_SERVE_UNVERIFIED")) offenders.push(full);
          }
        }
      };
      for (const dir of ["app", "components", "features", "hooks", "lib"]) walk(path.join(root, dir));
      expect(offenders).toStrictEqual([]);
    });
  });
});

describe("isFallbackPipelineEnabled", () => {
  it("is off when the variable is not set", () => {
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, undefined);
    expect(isFallbackPipelineEnabled()).toBe(false);
  });

  it("is off for empty, whitespace and near-misses", () => {
    for (const raw of ["", "   ", "0", "false", "no", "off", "TRUEISH", "yes please", "1 "]) {
      vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, raw);
      expect(isFallbackPipelineEnabled(), JSON.stringify(raw)).toBe(raw.trim() === "1");
    }
  });

  it("is on only for the four words it documents, in any case", () => {
    for (const raw of ["1", "true", "TRUE", "Yes", " on "]) {
      vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, raw);
      expect(isFallbackPipelineEnabled(), raw).toBe(true);
    }
  });

  it("reads the variable at call time, not at import time", () => {
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, "true");
    expect(isFallbackPipelineEnabled()).toBe(true);
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, "false");
    expect(isFallbackPipelineEnabled()).toBe(false);
  });

  it("is independent of SERVE_UNVERIFIED_AI, in both directions", () => {
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, "true");
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, undefined);
    expect(isFallbackPipelineEnabled()).toBe(false);
    vi.stubEnv(SERVE_UNVERIFIED_AI_ENV, undefined);
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, "true");
    expect(isServeUnverifiedAiEnabled()).toBe(false);
  });

  it("is read by the literal spelling Next.js inlines into a browser bundle", () => {
    // A computed `process.env[ENABLE_FALLBACK_PIPELINE_ENV]` passes every
    // test above under Node and is permanently off in a browser.
    const source = readFileSync(path.join(__dirname, "..", "serveFlags.ts"), "utf8");
    expect(source).toContain("process.env.NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE)");
    expect(ENABLE_FALLBACK_PIPELINE_ENV).toBe("NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE");
  });

  it("is declared off in every environment template the repository ships", () => {
    // `.env.local` itself is never read here. The templates are what a new
    // environment is built from, so each must carry the flag empty.
    const root = path.join(__dirname, "..", "..", "..");
    for (const file of [".env.local.example", ".env.development.local.example"]) {
      const lines = readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
      const entries = lines.filter((line) => line.startsWith(`${ENABLE_FALLBACK_PIPELINE_ENV}=`));
      expect(entries, file).toStrictEqual([`${ENABLE_FALLBACK_PIPELINE_ENV}=`]);
    }
  });
});
