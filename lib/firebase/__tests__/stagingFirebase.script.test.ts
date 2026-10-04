/**
 * `scripts/stagingFirebase.mjs` is the only thing in the repo that mutates a
 * staging project. These run it as a real process, with a scrubbed
 * environment (nothing from the developer's shell or `.env.local`), and only
 * ever as a dry run or a refusal: no case here can reach Firebase.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAGING_REFUSAL_MESSAGE } from "../projectGuard";
import { PROD_SERVICE_ACCOUNT, serviceAccount } from "./syntheticAccounts";
// Plain .mjs with no declarations; `allowJs` lets tsc infer its shape.
import * as script from "../../../scripts/stagingFirebase.mjs";

const SCRIPT = path.resolve(__dirname, "../../../scripts/stagingFirebase.mjs");
const STAGING = "legacy2uni-staging";
const STAGING_EMAIL = serviceAccount("convert2uni-server", STAGING);

function runScript(args: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("plannedCommands", () => {
  it("deploys rules, indexes and storage to the explicit staging project only", () => {
    expect(script.plannedCommands("deploy", STAGING)).toEqual([
      [
        "firebase",
        "deploy",
        "--only",
        "firestore:rules,firestore:indexes,storage",
        "--project",
        STAGING,
        "--non-interactive",
      ],
    ]);
  });

  it("sets a TTL policy on expireAt for every expiring collection, each with an explicit project", () => {
    const commands = script.plannedCommands("ttl", STAGING);
    expect(commands.map((argv: string[]) => argv.find((part) => part.startsWith("--collection-group=")))).toEqual(
      script.TTL_COLLECTIONS.map((collection: string) => `--collection-group=${collection}`),
    );
    for (const argv of commands) expect(argv).toContain(`--project=${STAGING}`);
  });
});

describe("the CLI fails closed", () => {
  it.each(["deploy", "ttl", "seed", "unseed", "probe"])("%s refuses with no staging project set", (command) => {
    const result = runScript([command, "--apply"], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no staging Firebase project id/);
  });

  it.each(["deploy", "ttl", "seed", "probe"])("%s refuses legacy2uni as the staging project", (command) => {
    const result = runScript([command, "--apply"], {
      STAGING_FIREBASE_PROJECT_ID: "legacy2uni",
      FIREBASE_ADMIN_PROJECT_ID: "legacy2uni",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(STAGING_REFUSAL_MESSAGE);
  });

  it("seed refuses when the Admin SDK variables still point at Production", () => {
    const result = runScript(["seed", "--apply"], {
      STAGING_FIREBASE_PROJECT_ID: STAGING,
      FIREBASE_ADMIN_PROJECT_ID: "legacy2uni",
      FIREBASE_ADMIN_CLIENT_EMAIL: PROD_SERVICE_ACCOUNT,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(STAGING_REFUSAL_MESSAGE);
  });

  it("rejects an unknown command", () => {
    expect(runScript(["wipe"], { STAGING_FIREBASE_PROJECT_ID: STAGING }).status).toBe(2);
  });
});

describe("dry run", () => {
  it("deploy prints the explicit-project command and runs nothing", () => {
    const result = runScript(["deploy"], { STAGING_FIREBASE_PROJECT_ID: STAGING });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`staging project: ${STAGING} (dry run`);
    expect(result.stdout).toContain(
      `would run: firebase deploy --only firestore:rules,firestore:indexes,storage --project ${STAGING} --non-interactive`,
    );
  });

  it("seed names the two fixture documents and writes nothing", () => {
    const result = runScript(["seed"], {
      STAGING_FIREBASE_PROJECT_ID: STAGING,
      FIREBASE_ADMIN_PROJECT_ID: STAGING,
      FIREBASE_ADMIN_CLIENT_EMAIL: STAGING_EMAIL,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`would create ${STAGING}: failurePatterns/staging-fixture-bijoy-u00a4`);
    expect(result.stdout).toContain(`would create ${STAGING}: aiResolutions/staging-fixture-bijoy-u00a4-accepted`);
  });
});
