/**
 * The staging fixture (`scripts/fixtures/stagingFixtures.mjs`) has one job:
 * once seeded, the Preview converter shows the approved accepted-fallback
 * label. This drives the real `/known` route with the fixture rows as the
 * Firestore result, then the converter and output panel exactly as the
 * rollout matrix does, with the pipeline on.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/firebase/admin", () => ({ isFirebaseAdminConfigured: true }));
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
import { GET } from "@/app/api/conversion-failures/known/route";
import { ConversionOutputText } from "@/components/converter/ConversionOutputText";
import { computeConversion } from "@/features/converter/fallbackPipeline";
import { convertLegacyText } from "@/features/converter/engine/pipeline";
import { resolutionMapFrom } from "@/features/converter/runConversion";
import type { KnownPatternsSnapshot } from "@/lib/conversionFailures/knownPatterns";
import { FALLBACK_ACCEPTED_LABEL } from "@/lib/conversionFailures/knownResolutions";
import { computeResolutionLookupKey } from "@/lib/conversionFailures/resolutionLookup";
import { aiResolutionSchema, failurePatternSchema } from "../schemas";
// Plain .mjs with no declarations; `allowJs` lets tsc infer its shape.
import * as fixtures from "../../../scripts/fixtures/stagingFixtures.mjs";

const NOW = "2026-10-04T00:00:00.000Z";
const docs = fixtures.stagingFixtureDocuments({ now: NOW });
const pattern = docs.find((doc) => doc.collection === "failurePatterns")!;
const resolution = docs.find((doc) => doc.collection === "aiResolutions")!;
const F = fixtures.ACCEPTED_FIXTURE;

describe("staging fixture documents", () => {
  it("are exactly one pattern and one resolution, both marked as staging fixtures", () => {
    expect(docs.map((doc) => `${doc.collection}/${doc.id}`)).toEqual([
      "failurePatterns/staging-fixture-bijoy-u00a4",
      "aiResolutions/staging-fixture-bijoy-u00a4-accepted",
    ]);
    for (const doc of docs) expect(doc.id.startsWith(fixtures.STAGING_FIXTURE_MARKER)).toBe(true);
  });

  it("parse under the app's own schemas", () => {
    expect(failurePatternSchema.safeParse(pattern.data).success).toBe(true);
    const parsed = aiResolutionSchema.safeParse(resolution.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reviewDecision).toBe("accepted");
      expect(parsed.data.patternId).toBe(pattern.id);
    }
  });

  it("carry the lookup key the app itself would compute", () => {
    expect(resolution.data.lookupKey).toBe(
      computeResolutionLookupKey({ encodingId: F.encodingId, failedSequence: F.failedSequence }),
    );
  });

  it("leave the pattern without expireAt, so TTL never removes it mid-canary", () => {
    expect(pattern.data).not.toHaveProperty("expireAt");
  });

  it("use a byte the engine really reports as unmapped in the smoke input", () => {
    const converted = convertLegacyText(F.smokeInput, F.encodingId);
    expect(converted.ok).toBe(true);
    if (converted.ok) {
      expect(converted.value.validation.unmappedSequences).toContain(F.failedSequence);
    }
  });
});

describe("seeded, the Preview converter shows the approved label", () => {
  it("publishes the fixture and renders it as an accepted fallback, in English and Bengali", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(listFailurePatterns).mockResolvedValue([]);
    vi.mocked(getFailurePatternStatuses).mockResolvedValue(new Map([[pattern.id, "open"]]));
    vi.mocked(listResolutionsForEncoding).mockResolvedValue([
      { id: resolution.id, ...aiResolutionSchema.parse(resolution.data) },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/conversion-failures/known?encodingId=bijoy&limit=7"),
    );
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as KnownPatternsSnapshot;
    expect(snapshot.resolutions).toEqual([
      expect.objectContaining({
        failedSequence: F.failedSequence,
        candidateConversion: F.candidateConversion,
        verification: "accepted",
      }),
    ]);

    const computed = computeConversion({
      text: F.smokeInput,
      encodingId: F.encodingId,
      pipelineEnabled: true,
      resolutions: resolutionMapFrom(snapshot, F.encodingId),
      serveUnverified: false,
    });
    expect(computed.output?.unicodeText).toContain(F.candidateConversion);
    const markup = renderToStaticMarkup(
      createElement(ConversionOutputText, { text: computed.output!.unicodeText, fallback: computed.fallback }),
    );
    expect(FALLBACK_ACCEPTED_LABEL.en).toBe("Accepted using AI-assisted fallback");
    expect(FALLBACK_ACCEPTED_LABEL.bn).toBe("AI-সহায়ক বিকল্প পদ্ধতিতে গ্রহণ করা হয়েছে");
    expect(markup).toContain(FALLBACK_ACCEPTED_LABEL.en);
    expect(markup).toContain(FALLBACK_ACCEPTED_LABEL.bn);
  });
});
