#!/usr/bin/env node
/**
 * Refuses to start `next dev` in emulator mode unless the override file that
 * makes it emulator mode actually exists.
 *
 * Without this the failure is silent and expensive: `.env.development.local`
 * missing means `next dev` falls straight through to `.env.local`, the app
 * comes up looking completely normal, and every local click writes a real
 * row to the production project — including `FieldValue.increment` on
 * `failurePatterns`, which corrupts the frequency data the triage UI ranks
 * by. Nothing announces that. This does.
 *
 * Read-only: it checks for a file and exits. It never reads the file's
 * contents, never writes one, and never touches `.env.local`.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const OVERRIDE = ".env.development.local";
const TEMPLATE = ".env.development.local.example";

const root = process.cwd();

if (!existsSync(path.join(root, OVERRIDE))) {
  console.error(
    [
      "",
      `  ${OVERRIDE} is missing, so this would run against whatever .env.local holds.`,
      "",
      `  Create it from the template, which needs no edits for emulator use:`,
      "",
      `      cp ${TEMPLATE} ${OVERRIDE}`,
      "",
      "  Then start the emulators in another terminal:",
      "",
      "      npm run emulators",
      "",
      "  See docs/dev-environment.md. To run against the real project instead,",
      "  use `npm run dev`.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
