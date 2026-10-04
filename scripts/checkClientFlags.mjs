#!/usr/bin/env node
/**
 * Reads a finished `next build` and reports what its browser bundle will do
 * with the two rollout flags. The rollback check for
 * `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE` (docs/rollout-canary-and-rollback.md,
 * Rollback A) and the standing check that `SERVE_UNVERIFIED_AI` cannot be on
 * in a browser.
 *
 * ## What a build looks like, observed on Next 16 / Turbopack (2026-10-04)
 *
 * - Pipeline variable **unset** at build time: the chunk keeps a runtime
 *   read, `<x>.env.NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE`, of Next's browser
 *   `process` polyfill, whose `env` is empty. Off.
 * - Pipeline variable **set**: the read is replaced by the literal, e.g.
 *   `O("true")`, and the variable's name no longer appears anywhere.
 * - `SERVE_UNVERIFIED_AI`: always a runtime read, `<x>.env.SERVE_UNVERIFIED_AI`,
 *   because `serveFlags.ts` reads it by a computed key and only
 *   `NEXT_PUBLIC_*` literals are inlined. Off in every browser.
 *
 * Reading an inlined literal back out of minified code is a heuristic, and is
 * reported as one: when the literal cannot be located unambiguously the
 * answer is "unknown", never a guess. The definitive check is still the
 * network panel (docs/rollout-readiness.md §4).
 *
 * Usage, from `convert2uni/`, after `npm run build`:
 *
 *   node scripts/checkClientFlags.mjs                        # report
 *   node scripts/checkClientFlags.mjs --expect-pipeline off  # rollback check
 *   node scripts/checkClientFlags.mjs --dir path/to/.next/static
 *
 * Exits 1 when `SERVE_UNVERIFIED_AI` is anything but a runtime read in the
 * converter's code, when no converter chunk is found, or when
 * `--expect-pipeline` does not hold. Never reads or prints an env file.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Restates `lib/conversionFailures/serveFlags.ts`; the script test keeps the two in step. */
export const TRUTHY = ["1", "true", "yes", "on"];

export function isTruthy(raw) {
  return typeof raw === "string" && TRUTHY.includes(raw.trim().toLowerCase());
}

const PIPELINE = "NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE";
const SERVE = "SERVE_UNVERIFIED_AI";
const CONVERTER_MARKER = "/api/conversion-failures/known";

const runtimeRead = (name) => new RegExp(`\\.env\\.${name}\\b|\\.env\\[["']${name}["']\\]`);

/** The minified name of `isTruthy`, taken from the call that wraps the unverified flag's runtime read. */
function truthyFnName(source) {
  const match = /([A-Za-z_$][\w$]*)\([\w$.]*\.env\.SERVE_UNVERIFIED_AI\)/.exec(source);
  return match ? match[1] : null;
}

/**
 * @param {string[]} sources the text of every client chunk
 * @returns {{
 *   converterFound: boolean,
 *   pipeline: { state: "off-unset" | "on" | "off-inlined" | "unknown", literal: string | null },
 *   serveUnverified: { state: "runtime-only" | "inlined" | "public-twin" },
 * }}
 */
export function inspectClientChunks(sources) {
  const converter = sources.filter((source) => source.includes(CONVERTER_MARKER));

  let serveState = "runtime-only";
  if (sources.some((source) => source.includes(`NEXT_PUBLIC_${SERVE}`))) serveState = "public-twin";
  else if (converter.length > 0 && !converter.some((source) => runtimeRead(SERVE).test(source))) {
    serveState = "inlined";
  }

  let pipeline = { state: "unknown", literal: null };
  if (sources.some((source) => runtimeRead(PIPELINE).test(source))) {
    pipeline = { state: "off-unset", literal: null };
  } else {
    // Inlined. The literal is the argument of the same `isTruthy` the
    // unverified read goes through, assigned just before the hook's
    // `useState(null)` for the loaded snapshot.
    const literals = new Set();
    for (const source of converter) {
      const fn = truthyFnName(source);
      if (fn === null) continue;
      const escaped = fn.replace(/\$/g, "\\$");
      const re = new RegExp(
        `\\b${escaped}\\("((?:[^"\\\\]|\\\\.)*)"\\),\\[[\\w$]+,[\\w$]+\\]=\\(0,[\\w$]+\\.useState\\)\\(null\\)`,
        "g",
      );
      for (const match of source.matchAll(re)) literals.add(JSON.parse(`"${match[1]}"`));
    }
    if (literals.size === 1) {
      const [literal] = literals;
      pipeline = { state: isTruthy(literal) ? "on" : "off-inlined", literal };
    }
  }

  return { converterFound: converter.length > 0, pipeline, serveUnverified: { state: serveState } };
}

/** Whether a result satisfies `--expect-pipeline`. "unknown" satisfies neither. */
export function pipelineMatches(state, expected) {
  if (expected === "on") return state === "on";
  if (expected === "off") return state === "off-unset" || state === "off-inlined";
  return true;
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
  const expected = arg("--expect-pipeline");
  if (expected !== null && expected !== "on" && expected !== "off") {
    console.error('--expect-pipeline takes "on" or "off".');
    return 2;
  }

  let files;
  try {
    files = listJs(dir);
  } catch {
    console.error(`No build output at ${dir}. Run \`npm run build\` first.`);
    return 1;
  }
  const result = inspectClientChunks(files.map((file) => readFileSync(file, "utf8")));

  const pipelineText = {
    "off-unset": "OFF (variable unset at build time; read at runtime from an empty process.env)",
    "off-inlined": `OFF (inlined at build time as ${JSON.stringify(result.pipeline.literal)}, not a truthy value)`,
    on: `ON (inlined at build time as ${JSON.stringify(result.pipeline.literal)})`,
    unknown: "UNKNOWN (inlined at build time, literal not located; use the network-panel check)",
  }[result.pipeline.state];
  const serveText = {
    "runtime-only": "OFF in every browser (runtime read only)",
    inlined: "BOUNDARY BROKEN: the converter no longer reads it at runtime",
    "public-twin": "BOUNDARY BROKEN: a NEXT_PUBLIC_ twin is in the client bundle",
  }[result.serveUnverified.state];

  console.log(`client chunks scanned: ${files.length}`);
  console.log(`converter chunk found: ${result.converterFound ? "yes" : "no"}`);
  console.log(`${PIPELINE}: ${pipelineText}`);
  console.log(`${SERVE}: ${serveText}`);

  let failed = false;
  if (!result.converterFound) {
    console.error("FAIL: no chunk contains the converter's snapshot request; nothing was checked.");
    failed = true;
  }
  if (result.serveUnverified.state !== "runtime-only") {
    console.error(`FAIL: ${SERVE} could be on in a browser.`);
    failed = true;
  }
  if (expected !== null && !pipelineMatches(result.pipeline.state, expected)) {
    console.error(`FAIL: expected the pipeline ${expected}, found ${result.pipeline.state}.`);
    failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
