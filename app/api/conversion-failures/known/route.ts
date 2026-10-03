import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { CONVERSION_ENGINE_VERSION } from "@/features/converter/engine/version";
import { getServerUser } from "@/lib/auth/session";
import { createMemoryCache } from "@/lib/cache";
import {
  KNOWN_PATTERNS_DEFAULT_LIMIT,
  KNOWN_PATTERNS_MAX_LIMIT,
  toKnownPattern,
  type KnownPatternsSnapshot,
} from "@/lib/conversionFailures/knownPatterns";
import { KNOWN_RESOLUTIONS_DEFAULT_LIMIT } from "@/lib/conversionFailures/knownResolutions";
import {
  publishablePatterns,
  publishableResolutions,
} from "@/lib/conversionFailures/publishable";
import { selectServableResolutions } from "@/lib/conversionFailures/selectResolutions";
import { isServeUnverifiedAiEnabled } from "@/lib/conversionFailures/serveFlags";
import { AppErrors } from "@/lib/errors/types";
import { failResponder, toAppError } from "@/lib/errors/handlers";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import {
  getFailurePatternStatuses,
  listFailurePatterns,
  listResolutionsForEncoding,
} from "@/lib/firebase/conversionFailures";
import { checkSharedRateLimit, rateLimitIdentity } from "@/lib/security/sharedRateLimit";

export const runtime = "nodejs";

const fail = failResponder("api/conversion-failures/known");

/**
 * Generous: this is a cheap read, it is meant to be called on page load, and
 * a client that respects the ETag will mostly get 304s anyway.
 */
const RATE_LIMIT = { limit: 120, windowMs: 5 * 60 * 1000 };

/** How long a built snapshot may be served without re-reading Firestore. */
const SNAPSHOT_TTL_MS = 60_000;

/**
 * Per-instance, best-effort, and explicitly not relied on for correctness: on
 * a serverless host there may be many instances, each with its own map, and
 * every map dies on a cold start. Its only job is to stop a burst of page
 * loads turning into a Firestore read each. A miss costs one query.
 */
const snapshotCache = createMemoryCache<{ snapshot: KnownPatternsSnapshot; etag: string }>({
  maxEntries: 32,
  defaultTtlMs: SNAPSHOT_TTL_MS,
});

/**
 * Hashes everything the client would render and nothing else. `generatedAt`
 * is deliberately excluded: including it would produce a new ETag on every
 * rebuild, so the conditional request would never return 304 and the header
 * would be decoration.
 */
function computeEtag(snapshot: KnownPatternsSnapshot): string {
  const material = JSON.stringify({
    encodingId: snapshot.encodingId,
    engineVersion: snapshot.engineVersion,
    patterns: snapshot.patterns,
    resolutions: snapshot.resolutions,
  });
  return `"${createHash("sha256").update(material).digest("hex").slice(0, 32)}"`;
}

/** RFC 9110 `If-None-Match`: a list, possibly weak-prefixed, possibly `*`. */
function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const candidates = header.split(",").map((part) => part.trim());
  if (candidates.includes("*")) return true;
  return candidates.some((candidate) => candidate.replace(/^W\//, "") === etag);
}

function cacheHeaders(etag: string): Record<string, string> {
  return {
    ETag: etag,
    // Short, because a newly-reported pattern should show up as known within
    // a minute or two rather than at the end of a browsing session.
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  };
}

/**
 * The known-patterns snapshot: which failed sequences this encoding is
 * already known to mishandle, most frequent first.
 *
 * Open to anonymous callers, like the POST beside it. What it publishes is
 * three fields per pattern — the short failed sequence, its category, and
 * whether it is resolved — built by `toKnownPattern`, which names each field
 * explicitly rather than spreading the stored document. No user text, no
 * occurrence ids, no counts, no timestamps per pattern.
 *
 * The counts are deliberately withheld even though they determine the order.
 * The ordering is the useful part; the absolute volume of a deployment's
 * conversion failures is operational data with no client-side use.
 *
 * Since Phase 4 it also publishes `resolutions`: what an accepted candidate
 * says the sequence should have been. Same reasoning applies to that array —
 * `hitCount` orders it and is not published, and
 * `lib/conversionFailures/selectResolutions.ts` builds each entry field by
 * field rather than forwarding a stored document. Nothing here is on the conversion path: the
 * converter produces the same output whether this endpoint answers or not.
 *
 * Both arrays are filtered by each pattern's **current** stored status at
 * build time (`lib/conversionFailures/publishable.ts`): only an `open`
 * pattern, and only a resolution whose provenance pattern is `open`, is
 * published. A pattern the re-verification sweep marks `resolved` drops out
 * of the next build with no write beyond that status change.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const encodingId = url.searchParams.get("encodingId");
  if (encodingId === null || encodingId.trim() === "") {
    return fail(
      AppErrors.validation("An encodingId is required.", { details: { field: "encodingId" } }),
    );
  }

  const limitParam = url.searchParams.get("limit");
  let limit = KNOWN_PATTERNS_DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > KNOWN_PATTERNS_MAX_LIMIT) {
      return fail(
        AppErrors.validation(`limit must be an integer between 1 and ${KNOWN_PATTERNS_MAX_LIMIT}.`, {
          details: { field: "limit" },
        }),
      );
    }
    limit = parsed;
  }

  if (!isFirebaseAdminConfigured) {
    // Mirrors the POST beside it: with no backend configured this degrades to
    // "nothing is known yet" rather than failing the page that asked.
    const snapshot: KnownPatternsSnapshot = {
      encodingId,
      engineVersion: CONVERSION_ENGINE_VERSION,
      patterns: [],
      resolutions: [],
      generatedAt: new Date().toISOString(),
    };
    const etag = computeEtag(snapshot);
    if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders(etag) });
    }
    return NextResponse.json(snapshot, { headers: cacheHeaders(etag) });
  }

  const user = await getServerUser(request);
  const caller = rateLimitIdentity(request, user);
  const rateLimit = await checkSharedRateLimit({
    key: `known-patterns:${caller.id}`,
    shared: caller.shared,
    ...RATE_LIMIT,
  });
  if (!rateLimit.ok) return fail(rateLimit.error);

  // The flag is part of the key, not just part of the content: flipping
  // `SERVE_UNVERIFIED_AI` must not be masked for a minute by a cached
  // snapshot built under the other setting.
  const serveUnverified = isServeUnverifiedAiEnabled();
  const cacheKey = `${encodingId}:${limit}:${serveUnverified ? "unverified" : "accepted"}`;

  try {
    let entry = await snapshotCache.get(cacheKey);

    if (entry === undefined) {
      // Three reads per snapshot build, all bounded and all paid at most
      // once per `SNAPSHOT_TTL_MS` per instance.
      const [patterns, stored] = await Promise.all([
        listFailurePatterns({ limit, encodingId, orderBy: "occurrenceCount" }),
        listResolutionsForEncoding({ encodingId, limit: KNOWN_RESOLUTIONS_DEFAULT_LIMIT * 2 }),
      ]);
      // A third, batched read: the current status of each resolution's
      // provenance pattern. Read rather than taken from `patterns` above,
      // because a resolution's pattern need not be in this encoding's top N.
      const statusByPatternId = await getFailurePatternStatuses(
        stored.map((resolution) => resolution.patternId),
      );
      const snapshot: KnownPatternsSnapshot = {
        encodingId,
        engineVersion: CONVERSION_ENGINE_VERSION,
        patterns: publishablePatterns(patterns).map(toKnownPattern),
        // The validator's second run happens inside this call. A resolution
        // an admin accepted months ago is republished only if it still
        // passes against today's rule tables — and only while the gap it
        // fills is still open.
        resolutions: selectServableResolutions({
          resolutions: publishableResolutions(stored, statusByPatternId),
          serveUnverified,
        }),
        generatedAt: new Date().toISOString(),
      };
      entry = { snapshot, etag: computeEtag(snapshot) };
      await snapshotCache.set(cacheKey, entry);
    }

    if (ifNoneMatchMatches(request.headers.get("if-none-match"), entry.etag)) {
      // 304 carries no body by definition, which is the entire saving: the
      // client keeps the copy it already cached.
      return new NextResponse(null, { status: 304, headers: cacheHeaders(entry.etag) });
    }

    return NextResponse.json(entry.snapshot, { headers: cacheHeaders(entry.etag) });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load the known conversion patterns."));
  }
}
