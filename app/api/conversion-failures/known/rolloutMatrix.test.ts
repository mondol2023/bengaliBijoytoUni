/**
 * The rollout matrix: the two switches, every combination, asserted on what
 * is externally visible rather than on the flags themselves.
 *
 *   NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE  — does the converter fetch the
 *     snapshot and render fallbacks (browser, fixed at build time)
 *   SERVE_UNVERIFIED_AI                   — does the public snapshot carry
 *     unreviewed AI candidates (server, read per request)
 *
 * Each case drives the real `GET /api/conversion-failures/known` (Firestore
 * mocked) under the server flag, feeds its JSON to the same client functions
 * `hooks/useConversion.ts` calls under the pipeline flag, and renders the
 * output panel to markup. Three things are checked per case:
 *
 * 1. **The public payload** — what anyone can read with a plain GET.
 * 2. **The network** — whether the converter asks for the snapshot at all.
 * 3. **The rendered output** — which segments a reader sees, and how marked.
 *
 * ## The browser never sees SERVE_UNVERIFIED_AI
 *
 * It is not a `NEXT_PUBLIC_` variable, so Next.js never puts it in a client
 * bundle, and `isServeUnverifiedAiEnabled()` is false in every browser. The
 * client side below therefore passes `serveUnverified: false` explicitly —
 * that is the value it has in production, whatever the server's is. The
 * consequence this file pins: **with both switches on, unverified candidates
 * are public in the API payload, but the converter still renders them as
 * unresolved.** "Full experimental" does not, today, put unreviewed text in
 * the converter's output.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ adminConfigured: true }));

vi.mock("@/lib/firebase/admin", () => ({
  get isFirebaseAdminConfigured() {
    return state.adminConfigured;
  },
}));
vi.mock("@/lib/firebase/conversionFailures", () => ({
  getFailurePatternStatuses: vi.fn(),
  listFailurePatterns: vi.fn(),
  listResolutionsForEncoding: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getServerUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/security/sharedRateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/sharedRateLimit")>();
  return { ...actual, checkSharedRateLimit: vi.fn(async () => ({ ok: true })) };
});

import {
  getFailurePatternStatuses,
  listFailurePatterns,
  listResolutionsForEncoding,
} from "@/lib/firebase/conversionFailures";
import { GET } from "./route";
import { ConversionOutputText } from "@/components/converter/ConversionOutputText";
import { computeConversion, snapshotRequest } from "@/features/converter/fallbackPipeline";
import { convertLegacyText } from "@/features/converter/engine/pipeline";
import { resolutionMapFrom } from "@/features/converter/runConversion";
import {
  ENABLE_FALLBACK_PIPELINE_ENV,
  SERVE_UNVERIFIED_AI_ENV,
  isFallbackPipelineEnabled,
  isServeUnverifiedAiEnabled,
} from "@/lib/conversionFailures/serveFlags";
import type { KnownPatternsSnapshot } from "@/lib/conversionFailures/knownPatterns";

const ACCEPTED_BYTE = "¤";
const UNVERIFIED_BYTE = "¥";
const INPUT = `Av${ACCEPTED_BYTE}Kv Av${UNVERIFIED_BYTE}Kv`;

function stored(overrides: Record<string, unknown>) {
  return {
    id: "resolution-accepted",
    patternId: "pattern-a",
    encodingId: "bijoy",
    failedSequence: ACCEPTED_BYTE,
    lookupKey: "lookup-a",
    provider: "gemini",
    model: "gemini-2.0-flash",
    promptVersion: "v2",
    engineVersion: "1.0.0",
    rulesHash: "rules",
    candidateConversion: "ক",
    reasoningSummary: null,
    confidence: "high",
    alternativeCandidates: [],
    isCertain: true,
    rawResponse: null,
    hitCount: 10,
    lastUsedAt: null,
    status: "reviewed",
    reviewDecision: "accepted",
    reviewedBy: "admin-1",
    reviewedAt: "2026-09-01T00:00:00.000Z",
    reviewNote: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const STORED = [
  stored({}),
  stored({
    id: "resolution-unverified",
    patternId: "pattern-u",
    failedSequence: UNVERIFIED_BYTE,
    lookupKey: "lookup-u",
    candidateConversion: "খ",
    hitCount: 0,
    status: "completed",
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
  }),
];

/** Off: unset, empty, whitespace, explicit false-likes, and near-misses. */
const OFF_VALUES = [undefined, "", "   ", "false", "0", "off", "no", "FALSE", "ture", "enabled"] as const;
/** On: the four documented words, any case, surrounding whitespace trimmed. */
const ON_VALUES = ["true", "1", "YES", " on ", "True"] as const;

/** One request limit per case keeps the route's per-instance cache from serving another case's build. */
let limit = 0;

function stub(name: string, value: string | undefined) {
  vi.stubEnv(name, value as string);
}

async function observe(pipelineValue: string | undefined, serveValue: string | undefined) {
  stub(ENABLE_FALLBACK_PIPELINE_ENV, pipelineValue);
  stub(SERVE_UNVERIFIED_AI_ENV, serveValue);

  // 1. The public payload, as any caller sees it.
  limit = (limit % 200) + 1;
  const response = await GET(
    new NextRequest(`http://localhost/api/conversion-failures/known?encodingId=bijoy&limit=${limit}`),
  );
  expect(response.status).toBe(200);
  const snapshot = (await response.json()) as KnownPatternsSnapshot;

  // 2 and 3. The converter, as `useConversion` drives it, with the browser's view of the server flag.
  const pipelineEnabled = isFallbackPipelineEnabled();
  const request = snapshotRequest(pipelineEnabled, "bijoy");
  const computed = computeConversion({
    text: INPUT,
    encodingId: "bijoy",
    pipelineEnabled,
    resolutions: request ? resolutionMapFrom(snapshot, "bijoy") : undefined,
    serveUnverified: false,
  });
  if (!computed.output) throw new Error("the engine should always convert this input");
  const markup = renderToStaticMarkup(
    createElement(ConversionOutputText, { text: computed.output.unicodeText, fallback: computed.fallback }),
  );

  return {
    published: snapshot.resolutions.map((entry) => `${entry.failedSequence}:${entry.verification}`).sort(),
    fetched: request !== null,
    computed,
    markup,
  };
}

const ENGINE = convertLegacyText(INPUT, "bijoy");
if (!ENGINE.ok) throw new Error("fixture must convert");
/** The output panel exactly as it rendered before Phase 6: the engine's text, unmarked. */
const PRE_PHASE_6_MARKUP = renderToStaticMarkup(
  createElement(ConversionOutputText, { text: ENGINE.value.unicodeText, fallback: null }),
);

beforeEach(() => {
  vi.unstubAllEnvs();
  state.adminConfigured = true;
  vi.mocked(listFailurePatterns).mockResolvedValue([]);
  vi.mocked(getFailurePatternStatuses).mockResolvedValue(
    new Map([
      ["pattern-a", "open"],
      ["pattern-u", "open"],
    ]),
  );
  vi.mocked(listResolutionsForEncoding).mockResolvedValue(STORED as never);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

function cases(pipeline: readonly (string | undefined)[], serve: readonly (string | undefined)[]) {
  return pipeline.flatMap((p) => serve.map((s) => [p, s] as const));
}

describe("pipeline OFF, unverified AI OFF: the pre-Phase-6 converter", () => {
  it.each(cases(OFF_VALUES, OFF_VALUES))("pipeline=%j serve=%j", async (p, s) => {
    expect(isServeUnverifiedAiEnabled()).toBe(false);
    const seen = await observe(p, s);
    expect(seen.fetched).toBe(false);
    expect(seen.computed.fallback).toBeNull();
    expect(seen.computed.output).toStrictEqual(ENGINE.value);
    expect(seen.markup).toBe(PRE_PHASE_6_MARKUP);
    expect(seen.published).toStrictEqual([`${ACCEPTED_BYTE}:accepted`]);
  });
});

describe("pipeline ON, unverified AI OFF: accepted fallbacks render, nothing unreviewed anywhere", () => {
  it.each(cases(ON_VALUES, OFF_VALUES))("pipeline=%j serve=%j", async (p, s) => {
    const seen = await observe(p, s);
    expect(seen.fetched).toBe(true);
    expect(seen.published).toStrictEqual([`${ACCEPTED_BYTE}:accepted`]);
    expect(seen.markup).toContain('data-fallback-state="fallback_accepted"');
    expect(seen.markup).toContain('data-fallback-state="unresolved"');
    expect(seen.markup).not.toContain("fallback_unverified");
    expect(seen.markup).not.toContain("খ");
    // Copy, Download and history read `output`, which is the engine's either way.
    expect(seen.computed.output).toStrictEqual(ENGINE.value);
  });
});

describe("pipeline OFF, unverified AI ON: the converter is untouched, but the API publishes", () => {
  it.each(cases(OFF_VALUES, ON_VALUES))("pipeline=%j serve=%j", async (p, s) => {
    const seen = await observe(p, s);
    expect(seen.fetched).toBe(false);
    expect(seen.computed.fallback).toBeNull();
    expect(seen.markup).toBe(PRE_PHASE_6_MARKUP);
    // The endpoint is public whatever the pipeline flag says.
    expect(seen.published).toStrictEqual([`${ACCEPTED_BYTE}:accepted`, `${UNVERIFIED_BYTE}:unverified`]);
  });
});

describe("pipeline ON, unverified AI ON: unverified text is public in the API, still unresolved in the converter", () => {
  it.each(cases(ON_VALUES, ON_VALUES))("pipeline=%j serve=%j", async (p, s) => {
    const seen = await observe(p, s);
    expect(seen.fetched).toBe(true);
    expect(seen.published).toStrictEqual([`${ACCEPTED_BYTE}:accepted`, `${UNVERIFIED_BYTE}:unverified`]);
    expect(seen.markup).toContain('data-fallback-state="fallback_accepted"');
    expect(seen.markup).not.toContain("fallback_unverified");
    expect(seen.markup).not.toContain("খ");
    expect(seen.computed.fallback?.unresolved.map((detail) => detail.sequence)).toStrictEqual([UNVERIFIED_BYTE]);
  });
});

describe("rollback", () => {
  it("turning the pipeline off after it was on restores the pre-Phase-6 output, fetch and markup", async () => {
    const on = await observe("true", "false");
    expect(on.markup).not.toBe(PRE_PHASE_6_MARKUP);

    const off = await observe(undefined, "false");
    expect(off.fetched).toBe(false);
    expect(off.computed).toStrictEqual({ output: ENGINE.value, error: null, fallback: null, fallbackFailed: false });
    expect(off.markup).toBe(PRE_PHASE_6_MARKUP);
  });

  it("turning unverified serving off drops unreviewed entries from the next build, with no cache masking it", async () => {
    const on = await observe("true", "true");
    expect(on.published).toContain(`${UNVERIFIED_BYTE}:unverified`);
    const off = await observe("true", "false");
    expect(off.published).toStrictEqual([`${ACCEPTED_BYTE}:accepted`]);
  });

  it("a client still holding a snapshot built with unverified serving on renders none of it", async () => {
    const stale = await observe("true", "true");
    expect(stale.published).toContain(`${UNVERIFIED_BYTE}:unverified`);
    // `observe` already applied that payload with the browser's view; this is
    // the same check named for the rollback window (browser/CDN max-age).
    expect(stale.markup).not.toContain("খ");
  });
});
