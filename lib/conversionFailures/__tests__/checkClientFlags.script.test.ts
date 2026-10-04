/**
 * `scripts/checkClientFlags.mjs` reads the rollout flags back out of a built
 * client bundle. It runs after `next build`, which this suite does not, so
 * its classifier is tested here on fragments copied from real Next 16 /
 * Turbopack builds of this app (2026-10-04), one per way the pipeline
 * variable can be built.
 *
 * It also restates the flag parsing for plain Node, which is the drift this
 * file exists to catch: a rule changed in `serveFlags.ts` and not in the
 * script would make the rollback check read a build differently from the
 * browser that runs it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENABLE_FALLBACK_PIPELINE_ENV,
  isFallbackPipelineEnabled,
} from "../serveFlags";
// Plain .mjs with no declarations; `allowJs` lets tsc infer its shape.
import * as script from "../../../scripts/checkClientFlags.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The fallback pipeline module, in every build: the unverified flag is a runtime read. */
const RUN_CONVERSION =
  'let n=i.value,r=t.resolutions??j,a=t.serveUnverified??O(N.default.env.SERVE_UNVERIFIED_AI);' +
  'fetch("/api/conversion-failures/known")';

/** `useConversion`, built with the variable unset. */
const HOOK_UNSET =
  '$=(0,p.useCallback)(()=>n(""),[]),b=O(N.default.env.NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE),[_,x]=(0,p.useState)(null);';

const hookInlined = (literal: string) =>
  `$=(0,p.useCallback)(()=>n(""),[]),b=O(${JSON.stringify(literal)}),[_,x]=(0,p.useState)(null);`;

describe("inspectClientChunks", () => {
  it("variable unset: off, read at runtime", () => {
    const result = script.inspectClientChunks([RUN_CONVERSION + HOOK_UNSET]);
    expect(result.converterFound).toBe(true);
    expect(result.pipeline).toStrictEqual({ state: "off-unset", literal: null });
    expect(result.serveUnverified.state).toBe("runtime-only");
  });

  it('variable "true": on', () => {
    const result = script.inspectClientChunks([RUN_CONVERSION + hookInlined("true")]);
    expect(result.pipeline).toStrictEqual({ state: "on", literal: "true" });
  });

  it('variable "false": off, inlined', () => {
    const result = script.inspectClientChunks([RUN_CONVERSION + hookInlined("false")]);
    expect(result.pipeline).toStrictEqual({ state: "off-inlined", literal: "false" });
  });

  it("finds the hook in a different chunk from the snapshot request", () => {
    const result = script.inspectClientChunks([RUN_CONVERSION, HOOK_UNSET]);
    expect(result.pipeline.state).toBe("off-unset");
  });

  it("says unknown, rather than guessing, when the literal cannot be located", () => {
    const reshaped = RUN_CONVERSION + 'b=O("true");let[_,x]=(0,p.useState)(null);';
    expect(script.inspectClientChunks([reshaped]).pipeline.state).toBe("unknown");
  });

  it("says unknown when two different literals match", () => {
    const both = RUN_CONVERSION + hookInlined("true") + hookInlined("false");
    expect(script.inspectClientChunks([both]).pipeline.state).toBe("unknown");
  });

  it("flags an unverified read that is no longer a runtime read", () => {
    const inlined = RUN_CONVERSION.replace("N.default.env.SERVE_UNVERIFIED_AI", '"true"');
    expect(script.inspectClientChunks([inlined + HOOK_UNSET]).serveUnverified.state).toBe("inlined");
  });

  it("flags a NEXT_PUBLIC_ twin of the unverified flag anywhere in the bundle", () => {
    const twin = "x=process.env.NEXT_PUBLIC_SERVE_UNVERIFIED_AI";
    const result = script.inspectClientChunks([RUN_CONVERSION + HOOK_UNSET, twin]);
    expect(result.serveUnverified.state).toBe("public-twin");
  });

  it("reports no converter when no chunk makes the snapshot request", () => {
    expect(script.inspectClientChunks(["console.log(1)"]).converterFound).toBe(false);
  });
});

describe("pipelineMatches", () => {
  it.each([
    ["off-unset", "off", true],
    ["off-inlined", "off", true],
    ["on", "off", false],
    ["unknown", "off", false],
    ["on", "on", true],
    ["off-unset", "on", false],
    ["unknown", "on", false],
  ] as const)("%s against --expect-pipeline %s: %s", (state, expected, matches) => {
    expect(script.pipelineMatches(state, expected)).toBe(matches);
  });
});

describe("the script parses a value the way serveFlags.ts does", () => {
  it.each([
    "1", "true", "TRUE", " Yes ", "on", "", "   ", "0", "false", "off", "no",
    '"true"', "'1'", "enabled", "true​", "1 x",
  ])("%j", (raw) => {
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, raw);
    expect(script.isTruthy(raw)).toBe(isFallbackPipelineEnabled());
  });

  it("an unset value is off in both", () => {
    vi.stubEnv(ENABLE_FALLBACK_PIPELINE_ENV, undefined);
    expect(script.isTruthy(undefined)).toBe(isFallbackPipelineEnabled());
  });
});
