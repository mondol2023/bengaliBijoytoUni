import type { NextConfig } from "next";

/**
 * Content-Security-Policy for this app. Kept pragmatic rather than
 * nonce-strict: Next.js's App Router streams hydration data through inline
 * `<script>` tags, and several components set inline `style` attributes
 * (chart colors sourced from CSS custom properties) — a nonce-based CSP
 * would need per-request nonce plumbing through `middleware.ts` and every
 * layout, which is a larger change than this hardening pass covers. This
 * still meaningfully narrows the default-allow-everything baseline: no
 * `object`/`embed`, no framing by other origins, no base-tag hijacking, and
 * a bounded `connect-src`/`frame-src` allowlist instead of a wildcard.
 *
 * `connect-src`/`frame-src` cover Firebase Auth (Identity Toolkit,
 * `securetoken`, the `*.firebaseapp.com` auth-helper iframe Google sign-in
 * popups rely on) and Firestore/Storage (`*.googleapis.com`). NOTE: no live
 * Firebase project exists yet for this app (see `docs/firebase-setup.md`),
 * so these origins have not been exercised against a real sign-in/Firestore
 * flow in a browser — check the browser console for CSP violations the
 * first time this runs against a live project and widen here if something
 * legitimate is blocked.
 */
const isDev = process.env.NODE_ENV !== "production";

// React's dev build (and Turbopack's HMR runtime) compile with eval(); the
// production bundle never does, so 'unsafe-eval' is dev-only.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.googleapis.com https://*.google.com",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
  // Belt-and-suspenders alongside `frame-ancestors 'none'` above, for
  // browsers that only understand the older header.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  ...(!isDev
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
