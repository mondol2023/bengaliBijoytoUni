/**
 * `scripts/checkReleaseArtifact.mjs` — the Firebase-project half of the
 * release gate. Fragments follow the shape of a real Next 16 / Turbopack
 * build of this app (2026-10-04); the API key is a placeholder.
 */
import { describe, expect, it } from "vitest";
// Plain .mjs with no declarations; `allowJs` lets tsc infer its shape.
import * as script from "../../../scripts/checkReleaseArtifact.mjs";
import { inspectClientChunks } from "../../../scripts/checkClientFlags.mjs";
import { STAGING_REFUSAL_MESSAGE } from "../projectGuard";

const STAGING = "legacy2uni-staging";

function sdkConfig(project: string, overrides: { authDomain?: string; storageBucket?: string } = {}) {
  const authDomain = overrides.authDomain ?? `${project}.firebaseapp.com`;
  const storageBucket = overrides.storageBucket ?? `${project}.appspot.com`;
  return (
    `let a={apiKey:"PLACEHOLDER",authDomain:"${authDomain}",projectId:"${project}",` +
    `storageBucket:"${storageBucket}",messagingSenderId:"1",appId:"1:1:web:1"}`
  );
}

/** The converter chunk: unverified flag a runtime read, pipeline unset (off) or inlined on. */
const CONVERTER_OFF =
  'let n=t.serveUnverified??O(N.default.env.SERVE_UNVERIFIED_AI);fetch("/api/conversion-failures/known");' +
  "let p=O(N.default.env.NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE)";
const CONVERTER_ON =
  'let n=t.serveUnverified??O(N.default.env.SERVE_UNVERIFIED_AI);fetch("/api/conversion-failures/known");' +
  'let p=O("true"),[s,c]=(0,r.useState)(null)';
const SERVE_TWIN = 'process.env.NEXT_PUBLIC_SERVE_UNVERIFIED_AI;fetch("/api/conversion-failures/known")';

function check(
  sources: string[],
  expected: { environment: "preview" | "production"; expectPipeline: "on" | "off"; expectProject: string | null },
) {
  return script.releaseFailures(expected, inspectClientChunks(sources), script.inspectFirebaseProject(sources));
}

const PREVIEW_ON = { environment: "preview", expectPipeline: "on", expectProject: STAGING } as const;

describe("inspectFirebaseProject", () => {
  it("reads the inlined project id", () => {
    expect(script.inspectFirebaseProject([sdkConfig(STAGING), "other chunk"])).toEqual({
      state: "inlined",
      projectIds: [STAGING],
      productionChunks: 0,
    });
  });

  it("does not count a staging id that starts with legacy2uni as Production", () => {
    expect(script.inspectFirebaseProject([sdkConfig("legacy2uni-preview-7f3a")]).productionChunks).toBe(0);
  });

  it("counts Production wherever it appears", () => {
    expect(script.inspectFirebaseProject([sdkConfig("legacy2uni")]).productionChunks).toBe(1);
    expect(
      script.inspectFirebaseProject([sdkConfig(STAGING, { storageBucket: "legacy2uni.appspot.com" })])
        .productionChunks,
    ).toBe(1);
  });

  it("reports an unset project and an ambiguous one", () => {
    expect(script.inspectFirebaseProject(["x=N.default.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID"]).state).toBe("unset");
    expect(script.inspectFirebaseProject(["nothing here"]).state).toBe("absent");
    expect(script.inspectFirebaseProject([sdkConfig(STAGING), sdkConfig("other-project")]).state).toBe("ambiguous");
  });
});

describe("releaseFailures, Preview", () => {
  it("passes a staging bundle with the pipeline on and SERVE_UNVERIFIED_AI runtime-only", () => {
    expect(check([sdkConfig(STAGING), CONVERTER_ON], PREVIEW_ON)).toEqual([]);
  });

  it("passes a staging bundle with the pipeline off when off is expected", () => {
    expect(check([sdkConfig(STAGING), CONVERTER_OFF], { ...PREVIEW_ON, expectPipeline: "off" })).toEqual([]);
  });

  it("refuses legacy2uni as the expected Preview project before reading anything", () => {
    expect(check([sdkConfig("legacy2uni"), CONVERTER_ON], { ...PREVIEW_ON, expectProject: "legacy2uni" })).toEqual([
      STAGING_REFUSAL_MESSAGE,
    ]);
  });

  it.each([null, "", "Not-An-Id", "demo-convert2uni"])("refuses expected project %j", (expectProject) => {
    const failures = check([sdkConfig(STAGING), CONVERTER_ON], { ...PREVIEW_ON, expectProject });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^Refusing staging operation/);
  });

  it("fails a Preview bundle built against Production", () => {
    const failures = check([sdkConfig("legacy2uni"), CONVERTER_ON], PREVIEW_ON);
    expect(failures.join("\n")).toMatch(/appears in 1 client chunk/);
    expect(failures.join("\n")).toMatch(/targets legacy2uni, expected legacy2uni-staging/);
  });

  it("fails a staging project id whose bucket or auth domain is still Production", () => {
    expect(check([sdkConfig(STAGING, { storageBucket: "legacy2uni.appspot.com" }), CONVERTER_ON], PREVIEW_ON)).toEqual([
      expect.stringMatching(/appears in 1 client chunk/),
    ]);
    expect(
      check([sdkConfig(STAGING, { authDomain: "legacy2uni.firebaseapp.com" }), CONVERTER_ON], PREVIEW_ON),
    ).toHaveLength(1);
  });

  it("fails a bundle built with no project, or an ambiguous one", () => {
    expect(check(["x=N.default.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID", CONVERTER_ON], PREVIEW_ON)).toEqual([
      expect.stringMatching(/is unset/),
    ]);
    expect(check([sdkConfig(STAGING), sdkConfig("other-project"), CONVERTER_ON], PREVIEW_ON)).toEqual([
      expect.stringMatching(/is ambiguous/),
    ]);
  });

  it("fails on a pipeline mismatch", () => {
    expect(check([sdkConfig(STAGING), CONVERTER_OFF], PREVIEW_ON)).toEqual([
      expect.stringMatching(/expected the pipeline on, found off-unset/),
    ]);
  });

  it("fails when SERVE_UNVERIFIED_AI could reach a browser", () => {
    expect(check([sdkConfig(STAGING), CONVERTER_ON, SERVE_TWIN], PREVIEW_ON)).toContainEqual(
      expect.stringMatching(/SERVE_UNVERIFIED_AI could be on in a browser \(public-twin\)/),
    );
  });

  it("fails when no converter chunk is present, since nothing about the flags was checked", () => {
    expect(check([sdkConfig(STAGING)], PREVIEW_ON)).toContainEqual(expect.stringMatching(/no chunk contains/));
  });
});

describe("releaseFailures, Production", () => {
  const PRODUCTION_OFF = { environment: "production", expectPipeline: "off", expectProject: "legacy2uni" } as const;

  it("passes the Production bundle on legacy2uni with the pipeline off", () => {
    expect(check([sdkConfig("legacy2uni"), CONVERTER_OFF], PRODUCTION_OFF)).toEqual([]);
  });

  it("refuses to accept a staging project for a production artifact", () => {
    expect(check([sdkConfig(STAGING), CONVERTER_OFF], { ...PRODUCTION_OFF, expectProject: STAGING })).toEqual([
      expect.stringMatching(/a production artifact must target legacy2uni/),
    ]);
  });

  it("fails a production artifact that was built against staging", () => {
    expect(check([sdkConfig(STAGING), CONVERTER_OFF], PRODUCTION_OFF)).toEqual([
      expect.stringMatching(/targets legacy2uni-staging, expected legacy2uni/),
    ]);
  });
});
