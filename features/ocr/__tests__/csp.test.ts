import { describe, expect, it } from "vitest";
// Next's own matcher, so this checks what the framework would do with each `source`.
// @ts-expect-error -- Next's vendored copy ships no type declarations
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import nextConfig from "../../../next.config";

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function headersFor(pathname: string): Promise<Map<string, string[]>> {
  const rules = (await nextConfig.headers?.()) as HeaderRule[];
  const merged = new Map<string, string[]>();
  for (const rule of rules) {
    const matcher = pathToRegexp(rule.source) as unknown as RegExp | { regexp: RegExp };
    const regexp = matcher instanceof RegExp ? matcher : matcher.regexp;
    if (!regexp.test(pathname)) continue;
    for (const { key, value } of rule.headers) merged.set(key, [...(merged.get(key) ?? []), value]);
  }
  return merged;
}

async function csp(pathname: string): Promise<string[]> {
  return (await headersFor(pathname)).get("Content-Security-Policy") ?? [];
}

describe("Content-Security-Policy", () => {
  it.each(["/ocr", "/ocr/lang/ben.traineddata.gz", "/ocr/core/tesseract-core-simd-lstm.wasm.js"])(
    "gives %s exactly one policy that lets Tesseract run",
    async (pathname) => {
      const policies = await csp(pathname);
      // Two CSP headers would be intersected by the browser, so a relaxed rule layered on top of
      // the global one would have no effect.
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
      expect(policies[0]).toMatch(/worker-src 'self' blob:/);
      expect(policies[0]).toMatch(/img-src[^;]*blob:/);
    },
  );

  it.each(["/", "/converter", "/documents", "/compare", "/admin", "/api/ocr/gemini", "/ocrfoo"])(
    "leaves %s on the strict policy",
    async (pathname) => {
      const policies = await csp(pathname);
      expect(policies).toHaveLength(1);
      expect(policies[0]).not.toMatch(/wasm-unsafe-eval/);
      expect(policies[0]).not.toMatch(/worker-src/);
      expect(policies[0]).not.toMatch(/blob:/);
    },
  );

  it("keeps every other protection on /ocr that the strict policy has", async () => {
    const [strict] = await csp("/documents");
    const [ocr] = await csp("/ocr");
    for (const directive of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(strict).toContain(directive);
      expect(ocr).toContain(directive);
    }
    expect(ocr).toContain("connect-src 'self' https://*.googleapis.com https://*.google.com");
  });

  it("sends the same non-CSP security headers on /ocr as everywhere else", async () => {
    const strict = await headersFor("/documents");
    const ocr = await headersFor("/ocr");
    for (const key of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(ocr.get(key)).toEqual(strict.get(key));
      expect(ocr.get(key)).toHaveLength(1);
    }
  });

  it("caches the self-hosted OCR runtime files like the dictionaries, but not the page", async () => {
    expect((await headersFor("/ocr/lang/ben.traineddata.gz")).get("Cache-Control")?.[0]).toMatch(/max-age=86400/);
    expect((await headersFor("/ocr")).get("Cache-Control")).toBeUndefined();
  });
});
