#!/usr/bin/env node
/**
 * Every mutating step of staging provisioning (docs/staging-environment.md),
 * behind one guard: the target is `STAGING_FIREBASE_PROJECT_ID`, checked by
 * `firebaseTarget.mjs` before anything is built or spawned, and
 * `legacy2uni` is refused outright. There is no default project and no use of
 * `firebase use` / `.firebaserc`: each Firebase CLI call carries an explicit
 * `--project`.
 *
 * **Dry run by default.** Each command prints what it would do and exits;
 * `--apply` does it.
 *
 *   deploy   rules, indexes and storage rules  (firebase deploy --only ... --project <staging>)
 *   ttl      the five TTL policies               (gcloud firestore fields ttls update ... --project=<staging>)
 *   seed     the synthetic accepted resolution   (scripts/fixtures/stagingFixtures.mjs)
 *   unseed   remove exactly the seeded fixture documents
 *   probe    controlled write + read-back of one synthetic `stagingProbes` document
 *
 * `seed`, `unseed` and `probe` use the Admin SDK and so also require
 * `FIREBASE_ADMIN_PROJECT_ID` to equal the staging id and the service
 * account's email to name the staging project. Load them from an untracked
 * file, never `.env.local` (which holds Production):
 *
 *   node --env-file=.env.staging.local scripts/stagingFirebase.mjs probe --apply
 *
 * Prints project ids, collection names and document ids only — never a key,
 * a credential field or document content beyond the fixture's own.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireStagingTarget } from "./firebaseTarget.mjs";
import { STAGING_FIXTURE_MARKER, stagingFixtureDocuments } from "./fixtures/stagingFixtures.mjs";

/** Collections with an `expireAt` the app writes, plus the probe's own (docs/data-retention.md, pending-manual-steps.md §1). */
export const TTL_COLLECTIONS = [
  "conversionFailures",
  "failurePatterns",
  "rateLimitWindows",
  "aiCallBudget",
  "stagingProbes",
];

export const PROBE_COLLECTION = "stagingProbes";

/** The exact external commands a step runs, so the dry run and the test can show them. */
export function plannedCommands(command, projectId) {
  if (command === "deploy") {
    return [
      [
        "firebase",
        "deploy",
        "--only",
        "firestore:rules,firestore:indexes,storage",
        "--project",
        projectId,
        "--non-interactive",
      ],
    ];
  }
  if (command === "ttl") {
    return TTL_COLLECTIONS.map((collection) => [
      "gcloud",
      "firestore",
      "fields",
      "ttls",
      "update",
      "expireAt",
      `--collection-group=${collection}`,
      "--enable-ttl",
      `--project=${projectId}`,
    ]);
  }
  return [];
}

function run(argv) {
  // The project id has already passed the project-id grammar, so the shell
  // Windows needs to find `firebase.cmd` cannot be handed anything to expand.
  const result = spawnSync(argv[0], argv.slice(1), { stdio: "inherit", shell: process.platform === "win32" });
  return result.status ?? 1;
}

async function adminDb(projectId) {
  const { cert, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
    projectId,
  });
  return getFirestore(app);
}

async function seed(projectId, apply) {
  const docs = stagingFixtureDocuments({ now: new Date().toISOString() });
  for (const doc of docs) console.log(`${apply ? "create" : "would create"} ${projectId}: ${doc.collection}/${doc.id}`);
  if (!apply) return 0;
  const db = await adminDb(projectId);
  for (const doc of docs) {
    const ref = db.collection(doc.collection).doc(doc.id);
    if ((await ref.get()).exists) {
      console.log(`already present, left as is: ${doc.collection}/${doc.id}`);
      continue;
    }
    await ref.create(doc.data);
  }
  return 0;
}

async function unseed(projectId, apply) {
  const docs = stagingFixtureDocuments({ now: new Date(0).toISOString() });
  for (const doc of docs) {
    if (!doc.id.startsWith(STAGING_FIXTURE_MARKER)) throw new Error(`not a fixture id: ${doc.id}`);
    console.log(`${apply ? "delete" : "would delete"} ${projectId}: ${doc.collection}/${doc.id}`);
  }
  if (!apply) return 0;
  const db = await adminDb(projectId);
  for (const doc of docs) await db.collection(doc.collection).doc(doc.id).delete();
  return 0;
}

async function probe(projectId, apply) {
  const id = `probe-${randomUUID()}`;
  console.log(`${apply ? "write" : "would write"} ${projectId}: ${PROBE_COLLECTION}/${id}`);
  if (!apply) return 0;
  const db = await adminDb(projectId);
  const now = new Date();
  const data = {
    marker: STAGING_FIXTURE_MARKER,
    synthetic: true,
    source: "scripts/stagingFirebase.mjs",
    createdAt: now.toISOString(),
    expireAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  };
  await db.collection(PROBE_COLLECTION).doc(id).create(data);
  const back = await db.collection(PROBE_COLLECTION).doc(id).get();
  const matches = back.exists && back.get("createdAt") === data.createdAt && back.get("marker") === data.marker;
  console.log(`read back: ${matches ? "match" : "MISMATCH"}`);
  console.log(`Check it in the ${projectId} console, and that ${PROBE_COLLECTION} does not exist in legacy2uni.`);
  return matches ? 0 : 1;
}

async function main(argv) {
  const [command] = argv;
  const apply = argv.includes("--apply");
  const commands = ["deploy", "ttl", "seed", "unseed", "probe"];
  if (!commands.includes(command)) {
    console.error(`Usage: node scripts/stagingFirebase.mjs <${commands.join("|")}> [--apply]`);
    return 2;
  }

  let projectId;
  try {
    projectId = requireStagingTarget(process.env, { admin: ["seed", "unseed", "probe"].includes(command) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.log(`staging project: ${projectId}${apply ? "" : " (dry run; add --apply to execute)"}`);

  if (command === "deploy" || command === "ttl") {
    for (const argvLine of plannedCommands(command, projectId)) {
      console.log(`${apply ? "run" : "would run"}: ${argvLine.join(" ")}`);
      if (apply) {
        const status = run(argvLine);
        if (status !== 0) return status;
      }
    }
    return 0;
  }
  if (command === "seed") return seed(projectId, apply);
  if (command === "unseed") return unseed(projectId, apply);
  return probe(projectId, apply);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
