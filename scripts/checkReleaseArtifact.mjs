#!/usr/bin/env node
/**
 * The release gate for a built artifact: rollout flags **and** Firebase
 * project, read out of the browser bundle `next build` produced, not out of
 * an env file. Phase 10; check 1 of the four in
 * docs/release-record-phase9.md ("Release gate").
 *
 * The flag half is `checkClientFlags.mjs`, imported rather than repeated.
 * The project half reads the client SDK config, which a build inlines as one
 * object literal (observed on Next 16 / Turbopack, 2026-10-04):
 *
 *   apiKey:"…",authDomain:"<id>.firebaseapp.com",projectId:"<id>",storageBucket:"…",…
 *
 * What it refuses, with `--environment preview`:
 *
 * - an expected project that is `legacy2uni`, missing, malformed or `demo-*`
 *   (`firebaseTarget.mjs`), before reading anything;
 * - a bundle whose inlined `projectId` is not exactly the expected one, or is
 *   ambiguous (more than one), or absent;
 * - **any** occurrence of the Production id in any client chunk, not just in
 *   `projectId` — an `authDomain` or `storageBucket` left on Production
 *   would point sign-in or uploads there while the project id looked right.
 *
 * With `--environment production`, the expected project must be `legacy2uni`
 * itself, so a staging id cannot be shipped to Production by the same
 * command with one word changed.
 *
 * This proves what the bundle is configured for, nothing more. The server's
 * Admin SDK project is a runtime value and is checked at runtime
 * (`GET /api/admin/firebase-identity`); the controlled write is
 * `scripts/stagingFirebase.mjs probe` and that route's POST.
 *
 * Usage, from `convert2uni/`, after `npm run build`:
 *
 *   npm run check:release-artifact -- --environment preview \
 *     --expect-pipeline on --expect-firebase-project <staging-id>
 *
 * Every flag is required. Exits 1 on any failure; never reads an env file.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectClientChunks, pipelineMatches } from "./checkClientFlags.mjs";
import { PRODUCTION_FIREBASE_PROJECT_ID, checkStagingTarget } from "./firebaseTarget.mjs";

const PROJECT_ENV = "NEXT_PUBLIC_FIREBASE_PROJECT_ID";

/** The SDK config literal: `authDomain` then `projectId`, as `lib/firebase/client.ts` orders them. */
const CONFIG_LITERAL = /authDomain:(?:"[^"]*"|void 0|[\w$.]+),projectId:"([^"]*)"/g;

/** The Production id as a whole project id — not a prefix of `legacy2uni-staging`. */
const PRODUCTION_TOKEN = new RegExp(`(?<![a-z0-9-])${PRODUCTION_FIREBASE_PROJECT_ID}(?![a-z0-9-])`);

/**
 * @param {string[]} sources the text of every client chunk
 * @returns {{
 *   state: "inlined" | "unset" | "ambiguous" | "absent",
 *   projectIds: string[],
 *   productionChunks: number,
 * }}
 */
export function inspectFirebaseProject(sources) {
  const ids = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(CONFIG_LITERAL)) ids.add(match[1]);
  }
  const productionChunks = sources.filter((source) => PRODUCTION_TOKEN.test(source)).length;
  const projectIds = [...ids].sort();

  let state;
  if (projectIds.length === 1) state = "inlined";
  else if (projectIds.length > 1) state = "ambiguous";
  else if (sources.some((source) => source.includes(`.env.${PROJECT_ENV}`))) state = "unset";
  else state = "absent";
  return { state, projectIds, productionChunks };
}

/**
 * Every failure for one artifact, as messages. Empty means it passes.
 *
 * @param {{ environment: string, expectPipeline: string, expectProject: string | null }} expected
 * @param {ReturnType<typeof inspectClientChunks>} flags
 * @param {ReturnType<typeof inspectFirebaseProject>} firebase
 */
export function releaseFailures(expected, flags, firebase) {
  const failures = [];

  if (expected.environment === "preview") {
    const target = checkStagingTarget(expected.expectProject);
    if (!target.ok) return [target.message];
    if (firebase.productionChunks > 0) {
      failures.push(
        `the Production project id (${PRODUCTION_FIREBASE_PROJECT_ID}) appears in ` +
          `${firebase.productionChunks} client chunk(s) of a Preview artifact.`,
      );
    }
  } else if (expected.expectProject !== PRODUCTION_FIREBASE_PROJECT_ID) {
    return [
      `a production artifact must target ${PRODUCTION_FIREBASE_PROJECT_ID}, ` +
        `not ${JSON.stringify(expected.expectProject)}.`,
    ];
  }

  if (firebase.state !== "inlined") {
    failures.push(`the client Firebase project is ${firebase.state} (${firebase.projectIds.join(", ") || "none"}).`);
  } else if (firebase.projectIds[0] !== expected.expectProject) {
    failures.push(
      `the client bundle targets ${firebase.projectIds[0]}, expected ${expected.expectProject}.`,
    );
  }

  if (!flags.converterFound) failures.push("no chunk contains the converter's snapshot request.");
  if (flags.serveUnverified.state !== "runtime-only") {
    failures.push(`SERVE_UNVERIFIED_AI could be on in a browser (${flags.serveUnverified.state}).`);
  }
  if (!pipelineMatches(flags.pipeline.state, expected.expectPipeline)) {
    failures.push(`expected the pipeline ${expected.expectPipeline}, found ${flags.pipeline.state}.`);
  }
  return failures;
}

function listJs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJs(full));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

function main(argv) {
  const arg = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1] ?? null;
  };
  const dir = arg("--dir") ?? path.join(".next", "static");
  const environment = arg("--environment");
  const expectPipeline = arg("--expect-pipeline");
  const expectProject = arg("--expect-firebase-project");

  if (environment !== "preview" && environment !== "production") {
    console.error('--environment takes "preview" or "production".');
    return 2;
  }
  if (expectPipeline !== "on" && expectPipeline !== "off") {
    console.error('--expect-pipeline takes "on" or "off".');
    return 2;
  }
  if (expectProject === null) {
    console.error("--expect-firebase-project is required; there is no default project.");
    return 2;
  }

  let files;
  try {
    files = listJs(dir);
  } catch {
    console.error(`No build output at ${dir}. Run \`npm run build\` first.`);
    return 1;
  }
  const sources = files.map((file) => readFileSync(file, "utf8"));
  const flags = inspectClientChunks(sources);
  const firebase = inspectFirebaseProject(sources);

  console.log(`environment: ${environment}`);
  console.log(`client chunks scanned: ${files.length}`);
  console.log(`pipeline: ${flags.pipeline.state}${flags.pipeline.literal === null ? "" : ` (${JSON.stringify(flags.pipeline.literal)})`}`);
  console.log(`SERVE_UNVERIFIED_AI: ${flags.serveUnverified.state === "runtime-only" ? "OFF in every browser" : flags.serveUnverified.state}`);
  console.log(`client Firebase project: ${firebase.state} ${firebase.projectIds.join(", ")}`.trimEnd());
  console.log(`chunks naming ${PRODUCTION_FIREBASE_PROJECT_ID}: ${firebase.productionChunks}`);

  const failures = releaseFailures({ environment, expectPipeline, expectProject }, flags, firebase);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  if (failures.length === 0) console.log("PASS");
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
