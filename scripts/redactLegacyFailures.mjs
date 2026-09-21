#!/usr/bin/env node
/**
 * Clears `fullText` and `engineOutput` on existing `conversionFailures`
 * documents.
 *
 * ## Why this exists
 *
 * The privacy bound in `lib/conversionFailures/occurrence.ts` stopped the
 * app collecting the whole input: every row written since carries
 * `fullText: ""`, `fullTextTruncated: false`, `engineOutput: null`. Rows
 * written *before* it still hold a copy of whatever the user pasted or
 * uploaded, and a bound that only applies going forward leaves the actual
 * documents sitting in the collection. This is the backfill.
 *
 * The fields are not dropped, only emptied. `conversionFailureSchema` still
 * requires them (a string, a boolean, a nullable string) so that old rows
 * parse on read; deleting the fields would make every remediated row fail
 * validation. Emptying them leaves a row indistinguishable from one written
 * after the bound.
 *
 * ## Safety properties
 *
 * - **Dry run by default.** Nothing is written without `--apply`.
 * - **Counts only.** No document content, no field values, no document IDs
 *   are ever printed — printing a sample of what it is about to redact
 *   would defeat the point of redacting it.
 * - **Batched.** Reads a page at a time and commits a bounded write batch,
 *   so a collection larger than memory, and larger than Firestore's
 *   500-writes-per-batch limit, is fine.
 * - **Idempotent.** The predicate matches only rows that still carry
 *   content, so a second run finds nothing and writes nothing. Safe to
 *   re-run after an interruption; safe to run on a schedule.
 * - **Resumable.** `--start-after <docId>` continues from a known point
 *   without re-reading the pages already done.
 *
 * Only `conversionFailures` is touched. `failurePatterns` has no field that
 * can hold document text — it stores the failed sequence and counts — so
 * there is nothing to remediate there.
 *
 * ## Usage
 *
 *   node scripts/redactLegacyFailures.mjs                  # dry run, counts only
 *   node scripts/redactLegacyFailures.mjs --apply          # write
 *   node scripts/redactLegacyFailures.mjs --apply --batch-size 250
 *   node scripts/redactLegacyFailures.mjs --limit 1000     # stop after N scanned
 *   node scripts/redactLegacyFailures.mjs --apply --start-after <docId>
 *
 * Requires the same FIREBASE_ADMIN_* env vars as the app (see
 * `.env.local.example`), loaded into the shell environment first:
 *
 *   set -a && source .env.local && set +a && node scripts/redactLegacyFailures.mjs
 *
 * Run the dry run first and read the counts. `needsRedaction` is how many
 * documents `--apply` would rewrite.
 */

import { cert, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

const COLLECTION = "conversionFailures";

/** Firestore caps a write batch at 500 operations. */
const MAX_BATCH_SIZE = 500;
const DEFAULT_BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    apply: false,
    batchSize: DEFAULT_BATCH_SIZE,
    limit: Infinity,
    startAfter: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--dry-run":
        options.apply = false;
        break;
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

  return options;
}

const USAGE = `Usage: node scripts/redactLegacyFailures.mjs [options]

  --apply                Write the changes. Without it, this is a dry run.
  --batch-size <n>       Documents per page and per write batch (default ${DEFAULT_BATCH_SIZE}, max ${MAX_BATCH_SIZE}).
  --limit <n>            Stop after scanning n documents.
  --start-after <docId>  Resume after a document ID, in ID order.
  --help                 Show this.`;

function fail(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

/**
 * True when a document still carries content the privacy bound says it
 * should not. Checked field by field rather than with a Firestore query
 * because "non-empty string" is not an indexable condition — and a query
 * over a field that some old rows may be missing entirely would silently
 * skip exactly those rows.
 *
 * Reading the values here is unavoidable — the document has to be fetched to
 * be rewritten — but nothing derived from them is printed or returned.
 */
function needsRedaction(data) {
  if (typeof data.fullText === "string" && data.fullText.length > 0) return true;
  if (data.fullTextTruncated === true) return true;
  if (typeof data.engineOutput === "string" && data.engineOutput.length > 0) return true;
  return false;
}

/** The post-bound shape: present, valid against the schema, and empty. */
const REDACTED = {
  fullText: "",
  fullTextTruncated: false,
  engineOutput: null,
};

// ---------------------------------------------------------------------------
// Main
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
console.log(`project:    ${projectId}`);
console.log(`collection: ${COLLECTION}`);
console.log(`mode:       ${options.apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
console.log(`batch size: ${options.batchSize}`);
if (options.limit !== Infinity) console.log(`limit:      ${options.limit}`);
if (options.startAfter !== null) console.log("resuming:   from --start-after");
console.log("");

let scanned = 0;
let needing = 0;
let updated = 0;
let pages = 0;
let failedBatches = 0;
let cursor = options.startAfter;

// Pages are sequential by construction: each query needs the previous page's cursor.
while (scanned < options.limit) {
  const pageSize = Math.min(options.batchSize, options.limit - scanned);
  let query = db.collection(COLLECTION).orderBy(FieldPath.documentId()).limit(pageSize);
  if (cursor !== null) query = query.startAfter(cursor);

  const snapshot = await query.get();
  if (snapshot.empty) break;

  pages++;
  scanned += snapshot.size;
  cursor = snapshot.docs[snapshot.docs.length - 1].id;

  const targets = snapshot.docs.filter((doc) => needsRedaction(doc.data()));
  needing += targets.length;

  if (options.apply && targets.length > 0) {
    const batch = db.batch();
    for (const doc of targets) batch.update(doc.ref, REDACTED);
    try {
      await batch.commit();
      updated += targets.length;
    } catch (error) {
      // Counted, not fatal: one bad page should not abandon the rest of the
      // collection, and the run is idempotent so the page can be retried.
      failedBatches++;
      console.error(`batch commit failed on page ${pages}: ${error instanceof Error ? error.name : "unknown error"}`);
    }
  }

  // Progress, so a long run over a large collection is not silent. Counts
  // only — no document IDs, no content.
  console.log(
    `page ${pages}: scanned ${scanned}, needing redaction ${needing}` +
      (options.apply ? `, updated ${updated}` : ""),
  );

  if (snapshot.size < pageSize) break;
}

console.log("");
console.log("--- summary ---");
console.log(`pages:            ${pages}`);
console.log(`scanned:          ${scanned}`);
console.log(`needs redaction:  ${needing}`);
console.log(`already clean:    ${scanned - needing}`);
if (options.apply) {
  console.log(`updated:          ${updated}`);
  console.log(`failed batches:   ${failedBatches}`);
} else {
  console.log(`updated:          0 (dry run — re-run with --apply to write)`);
}

// A failed batch means the collection is not fully remediated; the exit code
// says so for a caller that scripted this.
process.exit(failedBatches > 0 ? 1 : 0);
