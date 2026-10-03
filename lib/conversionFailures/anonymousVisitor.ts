/**
 * A random id that tells one signed-out browser apart from another in the
 * conversion-failure pipeline, so an admin sees `anonymous7` rather than an
 * undifferentiated "anonymous" on every report.
 *
 * The id is created only when a signed-out visitor first has a failure to
 * report, kept in `localStorage`, and sent with each report. The server
 * never stores it: it hashes it and maps the hash to a sequential label
 * (`lib/firebase/anonymousVisitors.ts`). It identifies a browser, not a
 * person — clearing site data or switching browsers yields a new one — and
 * it is never linked to an account the visitor later signs into.
 *
 * Client-safe: no Node imports.
 */
import type { StorageLike } from "./outbox";

export const ANONYMOUS_VISITOR_STORAGE_KEY = "convert2uni.anonymousVisitorId";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The only shape the server accepts. Shared by both ends so they cannot disagree. */
export function isAnonymousVisitorId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

/** Used when storage is unavailable: one id for this page's lifetime. */
let pageLifetimeId: string | null = null;

export function getAnonymousVisitorId(
  storage: StorageLike | null,
  newId: () => string = () => crypto.randomUUID(),
): string {
  if (storage !== null) {
    try {
      const stored = storage.getItem(ANONYMOUS_VISITOR_STORAGE_KEY);
      if (isAnonymousVisitorId(stored)) return stored;
      const id = newId();
      storage.setItem(ANONYMOUS_VISITOR_STORAGE_KEY, id);
      return id;
    } catch {
      // Fall through to the page-lifetime id.
    }
  }
  pageLifetimeId ??= newId();
  return pageLifetimeId;
}

export function __resetAnonymousVisitorForTests(): void {
  pageLifetimeId = null;
}
