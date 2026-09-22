#!/usr/bin/env node
/**
 * Stamps `expireAt` onto `conversionFailures` and `failurePatterns`
 * documents that were written before the field existed.
 *
 * ## Why this exists
 *
 * `lib/conversionFailures/retention.ts` gives every *new* document an
 * `expireAt`. Documents written before that change have no such field, and
 * Firestore's TTL service silently never expires a document whose named
 * field is missing — no error, no warning. So enabling the TTL policies
 * bounds everything written from now on and leaves the entire existing
 * collection immortal. This closes that.
 *
 * ## Run order: redact first, then backfill
 *
 * `scripts/redactLegacyFailures.mjs` **must be run to completion first.**
 * Redaction removes the actual user documents from old rows and is the
 * urgent half; backfill only schedules those rows for eventual deletion. If
 * backfill ran first and TTL were enabled, some rows would be deleted before
 * redaction reached them — which sounds like the same outcome and is not:
 * the deletion is spread over up to 24 hours and is not guaranteed to
 * complete, so the result is an unknown remainder still holding whole
 * documents, with no way to tell which. Redaction is the operation whose
 * completion you can verify. Do it first.
 *
 *   1. node scripts/redactLegacyFailures.mjs            # dry run, read counts
 *   2. node scripts/redactLegacyFailures.mjs --apply    # until "needs redaction: 0"
 *   3. node scripts/backfillRetention.mjs               # dry run, read counts
 *   4. node scripts/backfillRetention.mjs --apply
 *   5. Create the TTL policies (docs/data-retention.md §3) — last.
 *
 * Step 5 is last on purpose. Nothing is ever deleted until it happens, so
 * every step before it is reversible: an `expireAt` written by mistake can
 * simply be overwritten while no policy is reading it.
 *
 * ## The clock each collection is stamped on
 *
 * Matching `lib/conversionFailures/retention.ts`, which is the definition —
 * if the periods there change, they change here by import, not by edit.
 *
 * | Collection | Base | Meaning |
 * | --- | --- | --- |
 * | `conversionFailures` | `createdAt` | Fixed. Expires a period after it was written. |
 * | `failurePatterns` | `lastSeenAt` | Sliding. Expires a period after it was last hit. |
 *
 * Basing the stamp on the document's own timestamp rather than on `now` is
 * the point: an old row then expires on the schedule it would have had if
 * the field had existed all along. **A consequence worth reading twice:** a
 * `conversionFailures` row older than the retention period gets an
 * `expireAt` in the past, and becomes eligible for deletion the moment the
 * TTL policy is enabled. The dry run counts those separately and prints the
 * count under `already past expiry` — read it before running `--apply`.
 *
 * Rows with a missing or unparseable base timestamp are stamped from `now`
 * instead, so they get a full period rather than being either deleted
 * immediately or left immortal. They are counted separately too.
 *
 * ## Safety properties
 *
 * - **Dry run by default.** Nothing is written without `--apply`.
 * - **Counts only.** No document IDs, no field values, no content.
 * - **Idempotent.** The predicate matches only documents with no `expireAt`,
 *   so a second run finds nothing. It never moves an existing stamp —
 *   including a sliding one the app has already pushed out, which a blind
 *   rewrite would pull backwards.
 * - **Batched and resumable.** A page at a time, a bounded write batch,
 *   `--start-after <docId>` to continue.
 * - **Additive.** It writes one field and reads no user content.
 *
 * `aiResolutions` is deliberately not touched: it holds admin review
 * decisions and the audit trail of a paid external call, carries no user
 * document text, and has no TTL policy.
 *
 * ## Usage
 *
 *   node scripts/backfillRetention.mjs                          # dry run, both collections
 *   node scripts/backfillRetention.mjs --apply
 *   node scripts/backfillRetention.mjs --collection failurePatterns
 *   node scripts/backfillRetention.mjs --apply --batch-size 250
 *   node scripts/backfillRetention.mjs --limit 1000
 *   node scripts/backfillRetention.mjs --apply --collection conversionFailures --start-after <docId>
 *
 * Requires the same FIREBASE_ADMIN_* env vars as the app, loaded into the
 * shell environment first:
 *
 *   set -a && source .env.local && set +a && node scripts/backfillRetention.mjs
 */

import { cert, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

/**
 * The retention periods. Restated in a `.mjs` sibling rather than imported
 * from `lib/conversionFailures/retention.ts`, which is the source of truth —
 * see that file's header for why, and for the test that fails if the two
 * ever disagree.
 */
import { RETENTION_DAYS, RETENTION_COLLECTIONS } from "./retentionPeriods.mjs";

/** Which field each collection's expiry is measured from. */
const BASE_FIELD = {
  conversionFailures: "createdAt",
  failurePatterns: "lastSeenAt",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Firestore caps a write batch at 500 operations. */
const MAX_BATCH_SIZE = 500;
const DEFAULT_BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/backfillRetention.mjs [options]

  --apply                 Write the changes. Without it, this is a dry run.
  --collection <name>     Only one of: ${RETENTION_COLLECTIONS.join(", ")}. Default: both.
  --batch-size <n>        Documents per page and per write batch (default ${DEFAULT_BATCH_SIZE}, max ${MAX_BATCH_SIZE}).
  --limit <n>             Stop after scanning n documents per collection.
  --start-after <docId>   Resume after a document ID, in ID order. Requires --collection.
  --help                  Show this.

Run scripts/redactLegacyFailures.mjs to completion first — see this file's header.`;

function fail(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    collections: [...RETENTION_COLLECTIONS],
    batchSize: DEFAULT_BATCH_SIZE,
    limit: Infinity,
    startAfter: null,
  };
  let collectionGiven = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--dry-run":
        options.apply = false;
        break;
      case "--collection": {
        const value = argv[++index];
        if (!RETENTION_COLLECTIONS.includes(value)) {
          fail(`--collection must be one of: ${RETENTION_COLLECTIONS.join(", ")}`);
        }
        options.collections = [value];
        collectionGiven = true;
        break;
      }
      case "--batch-size": {
        const value = Number(argv[++index]);
        if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
          fail(`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}`);
        }
        options.batchSize = value;
        break;
      }
      case "--limit": {
        const value = Number(argv[++index]);
        if (!Number.isInteger(value) || value < 1) fail("--limit must be a positive integer");
        options.limit = value;
        break;
      }
      case "--start-after": {
        const value = argv[++index];
        if (!value) fail("--start-after needs a document ID");
        options.startAfter = value;
        break;
      }
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  // A cursor is a position within one collection's ID ordering; applying it
  // to both would silently skip an arbitrary prefix of the second.
  if (options.startAfter !== null && !collectionGiven) {
    fail("--start-after requires --collection, since a cursor belongs to one collection's ordering");
  }

  return options;
}

// ---------------------------------------------------------------------------
// The predicate and the stamp
// ---------------------------------------------------------------------------

/**
 * True when a document has no `expireAt` at all.
 *
 * Deliberately not a Firestore `where` clause: a query cannot match "field
 * absent", and one written the other way round — `where("expireAt", "==",
 * null)` — would match nothing, because these documents do not hold null,
 * they hold no key. Filtering in the client is the only correct read here,
 * which is why every document is paged through rather than queried for.
 *
 * Also the idempotence guarantee, and the reason the sliding clock is safe:
 * a `failurePatterns` document the app has already pushed forward has an
 * `expireAt`, so this never pulls it backwards.
 */
function needsStamp(data) {
  return data.expireAt === undefined || data.expireAt === null;
}

/**
 * Milliseconds for the timestamp a document's expiry is measured from, or
 * null when it has none that parses. Timestamps in this codebase are ISO
 * strings; a Firestore `Timestamp` is accepted too, in case a row predates
 * that convention.
 */
function baseMillis(data, field) {
  const value = data[field];
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const options = parseArgs(process.argv.slice(2));

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "Missing FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY in the environment.",
  );
  process.exit(1);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

// The project is named so an operator cannot discover afterwards that they
// pointed a write run at the wrong one.
console.log(`project:     ${projectId}`);
console.log(`collections: ${options.collections.join(", ")}`);
console.log(`mode:        ${options.apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
console.log(`batch size:  ${options.batchSize}`);
if (options.limit !== Infinity) console.log(`limit:       ${options.limit} per collection`);
if (options.startAfter !== null) console.log("resuming:    from --start-after");
console.log("");

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

const now = Date.now();

async function backfill(collection) {
  const field = BASE_FIELD[collection];
  const retentionMs = RETENTION_DAYS[collection] * DAY_MS;

  console.log(`--- ${collection} (${RETENTION_DAYS[collection]} days from ${field}) ---`);

  const totals = {
    pages: 0,
    scanned: 0,
    needing: 0,
    stamped: 0,
    /** Would be deleted on the first TTL pass, because their period has already elapsed. */
    alreadyPast: 0,
    /** No parseable base timestamp, so stamped a full period from now instead. */
    noBaseTimestamp: 0,
    failedBatches: 0,
  };

  let cursor = options.startAfter;

  // Pages are sequential by construction: each query needs the previous
  // page's cursor.
  while (totals.scanned < options.limit) {
    const pageSize = Math.min(options.batchSize, options.limit - totals.scanned);
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor !== null) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    totals.pages++;
    totals.scanned += snapshot.size;
    cursor = snapshot.docs[snapshot.docs.length - 1].id;

    const writes = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (!needsStamp(data)) continue;

      totals.needing++;

      const base = baseMillis(data, field);
      if (base === null) totals.noBaseTimestamp++;

      const expireAtMs = (base ?? now) + retentionMs;
      if (expireAtMs <= now) totals.alreadyPast++;

      writes.push({ ref: doc.ref, expireAt: new Date(expireAtMs) });
    }

    if (options.apply && writes.length > 0) {
      const batch = db.batch();
      // `update`, not `set(..., { merge: true })`: update fails on a document
      // that has since been deleted, which is the correct outcome here —
      // merge would resurrect it as a document holding nothing but an
      // expiry.
      for (const write of writes) batch.update(write.ref, { expireAt: write.expireAt });
      try {
        await batch.commit();
        totals.stamped += writes.length;
      } catch (error) {
        // Counted, not fatal: one bad page should not abandon the rest of
        // the collection, and the run is idempotent so the page can be
        // retried.
        totals.failedBatches++;
        console.error(
          `batch commit failed on page ${totals.pages}: ${error instanceof Error ? error.name : "unknown error"}`,
        );
      }
    }

    // Counts only — no document IDs, no content.
    console.log(
      `page ${totals.pages}: scanned ${totals.scanned}, needing stamp ${totals.needing}` +
        (options.apply ? `, stamped ${totals.stamped}` : ""),
    );

    if (snapshot.size < pageSize) break;
  }

  console.log("");
  console.log(`pages:               ${totals.pages}`);
  console.log(`scanned:             ${totals.scanned}`);
  console.log(`needs expireAt:      ${totals.needing}`);
  console.log(`already stamped:     ${totals.scanned - totals.needing}`);
  console.log(`already past expiry: ${totals.alreadyPast}   <- deleted on the first TTL pass`);
  console.log(`no base timestamp:   ${totals.noBaseTimestamp}   <- stamped a full period from now`);
  if (options.apply) {
    console.log(`stamped:             ${totals.stamped}`);
    console.log(`failed batches:      ${totals.failedBatches}`);
  } else {
    console.log(`stamped:             0 (dry run — re-run with --apply to write)`);
  }
  console.log("");

  return totals;
}

let failedBatches = 0;
let alreadyPast = 0;

for (const collection of options.collections) {
  const totals = await backfill(collection);
  failedBatches += totals.failedBatches;
  alreadyPast += totals.alreadyPast;
}

if (!options.apply && alreadyPast > 0) {
  console.log(
    `NOTE: ${alreadyPast} document(s) would be stamped with an expiry already in the past.\n` +
      "      Enabling the TTL policies deletes them within about 24 hours. That is the\n" +
      "      intended behaviour — they expire on the schedule they would have had — but\n" +
      "      confirm the number looks right before running with --apply.",
  );
}

// A failed batch means the collections are not fully stamped, and a document
// left without `expireAt` is one the TTL service will never expire. The exit
// code says so for a caller that scripted this.
process.exit(failedBatches > 0 ? 1 : 0);
