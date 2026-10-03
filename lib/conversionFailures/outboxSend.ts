/**
 * Sends one `FailureOutbox` batch to `/api/conversion-failures` and says
 * what the outbox should do with it. Kept out of the hook so the attribution
 * rules below are testable without React.
 *
 * ## Attribution is fixed when the batch was queued
 *
 * - `anonymous` → no token, the batch's own visitor id. Even if the visitor
 *   has since signed in, the report stays anonymous.
 * - `user` → a token only if that same user is still signed in. Otherwise
 *   the batch goes unattributed: no token *and* no visitor id, so it is
 *   neither credited to whoever is signed in now nor merged with an
 *   anonymous visitor.
 * - `unknown` (queued before the sign-in check finished) → whoever is signed
 *   in when it is sent, which is the same moment for practical purposes.
 */
import type { OutboxBatch, SendOutcome } from "./outbox";

/**
 * Browsers refuse a `keepalive` request whose body would push the in-flight
 * keepalive total past 64 KiB, and they refuse it by throwing — which would
 * read as a network failure and retry forever. A maximal report (50 entries)
 * is larger than that, so keepalive is used only below this size.
 */
export const KEEPALIVE_BODY_LIMIT = 60_000;

export interface OutboxSendDeps {
  currentUid: () => string | null;
  getIdToken: () => Promise<string | null>;
  visitorId: () => string;
  fetchImpl?: typeof fetch;
}

export async function sendOutboxBatch<F>(batch: OutboxBatch<F>, deps: OutboxSendDeps): Promise<SendOutcome> {
  const uid = deps.currentUid();
  let withToken = false;
  let anonymousVisitorId: string | undefined;

  switch (batch.auth.kind) {
    case "anonymous":
      anonymousVisitorId = batch.auth.visitorId;
      break;
    case "user":
      withToken = uid !== null && uid === batch.auth.uid;
      break;
    case "unknown":
      if (uid !== null) withToken = true;
      else anonymousVisitorId = deps.visitorId();
      break;
  }

  try {
    const idToken = withToken ? await deps.getIdToken() : null;
    const body = JSON.stringify({
      failures: batch.failures,
      ...(anonymousVisitorId ? { anonymousVisitorId } : {}),
    });
    const response = await (deps.fetchImpl ?? fetch)("/api/conversion-failures", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body,
      // Survives the navigation a pagehide drain is racing, where allowed.
      keepalive: new TextEncoder().encode(body).length < KEEPALIVE_BODY_LIMIT,
    });
    if (response.ok) return "delivered";
    if (response.status === 408 || response.status === 429 || response.status >= 500) return "retry";
    return "rejected";
  } catch {
    return "retry";
  }
}
