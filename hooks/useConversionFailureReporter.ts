"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { buildFailureOccurrence, buildSignalOccurrence } from "@/lib/conversionFailures/occurrence";
import { createReportBuffer, type BufferedReport } from "@/lib/conversionFailures/reportBuffer";
import {
  browserStorage,
  createFailureOutbox,
  OUTBOX_DRAIN_INTERVAL_MS,
  type FailureOutbox,
  type OutboxAuth,
} from "@/lib/conversionFailures/outbox";
import { sendOutboxBatch } from "@/lib/conversionFailures/outboxSend";
import { getAnonymousVisitorId } from "@/lib/conversionFailures/anonymousVisitor";
import type { ConversionOutput } from "@/features/converter/engine/pipeline";

export interface ConversionFailureReportContext {
  source: "text" | "file" | "comparison" | "api";
  encodingId: string | null;
  fileName?: string | null;
  fileType?: string | null;
}

function patternKey(encodingId: string | null, engineVersion: string, sequence: string): string {
  return `${encodingId ?? ""}|${engineVersion}|${sequence}`;
}

/**
 * How long a delta may sit in memory before it is moved into the
 * `localStorage` outbox. Short, because memory is lost with the tab and the
 * outbox is not.
 */
const FLUSH_DELAY_MS = 5_000;

const OUTBOX_LOCK_NAME = "convert2uni-failure-outbox";

/**
 * Runs `fn` while holding a cross-tab Web Lock, so two tabs never send the
 * same queued batch; skips it if another tab is already draining. Where the
 * Web Locks API is missing, runs it unguarded: the outbox's take-before-send
 * rule still stops a batch being sent twice in most interleavings.
 */
function withOutboxLock(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return fn();
  return locks
    .request(OUTBOX_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) await fn();
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

type OutboxFailure = BufferedReport["occurrence"] & { occurrenceCount: number; sessionId: string };

/**
 * Posts occurrences to `/api/conversion-failures` for the conversion-failure
 * intelligence pipeline (see `docs/conversion-failure-pipeline.md`) —
 * separate from `useIssueLog`, which feeds the lightweight, real-time
 * `errorLogs` feed and stays untouched.
 *
 * Each report carries the failed sequence plus a bounded context window and
 * nothing more; `buildFailureOccurrence` owns that bound and the server
 * discards anything wider. The window is sliced from `output.sourceText`
 * rather than the raw input, because source hygiene can shift the offsets
 * the validation reports (see `ConversionOutput.sourceText`).
 *
 * Scoped to the two failures that have a clear sequence and position a
 * human can act on: `unmapped_character` (no rule matched) and
 * `ambiguous_typography` (a byte that is both Latin punctuation and a real
 * conjunct, flagged but deliberately not changed — see `normalizeSource`).
 * Whole-output warnings from `validateUnicodeOutput` (reorder defects, NFC
 * mismatches) describe a property of the entire result rather than one
 * legacy sequence, so they don't fit this pattern-keyed model without
 * inventing an identifier for them — they continue to surface only through
 * the existing `errorLogs` feed via `useIssueLog`.
 *
 * ## Batching
 *
 * Occurrences accumulate in a `ReportBuffer` and are sent as count deltas:
 * one request saying a pattern occurred forty-seven more times, rather than
 * one request per occurrence — or, as this hook used to behave, one report
 * per pattern per mount regardless of how many times it actually occurred.
 * That old rule made `occurrenceCount` a count of sessions wearing the name
 * of a count of occurrences; see `reportBuffer.ts` for what replaced it and
 * why the replacement is monotone.
 *
 * Flushes on a short timer, when the buffer fills, when the page is hidden,
 * and on unmount — the last three matter because a user who pastes a
 * document and immediately closes the tab is exactly the case worth
 * counting.
 *
 * ## Outbox
 *
 * A flushed batch goes into a `localStorage` outbox (`outbox.ts`), not
 * straight to the network. The outbox is sent every `OUTBOX_DRAIN_INTERVAL_MS`,
 * when the page is hidden or closed, on unmount, and on the next visit for
 * anything an earlier one left behind (offline, a failed request, a crash).
 *
 * ## Anonymous visitors
 *
 * A batch queued while signed out carries the browser's anonymous visitor id
 * (`anonymousVisitor.ts`), which the server turns into an `anonymousN`
 * label. Who a batch belongs to is fixed when it is queued — see
 * `outboxSend.ts` for why.
 *
 * Strictly fire-and-forget throughout: a failed report never surfaces to the
 * user, who is not looking at this pipeline at all.
 */
export function useConversionFailureReporter(
  context: ConversionFailureReportContext,
  output: ConversionOutput | null,
): void {
  const { user, getIdToken, isLoading } = useAuth();
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  // Read inside callbacks rather than captured, so the auth state at the
  // moment of queueing or sending is what is used. Updated in an effect,
  // never during render.
  const authRef = useRef({ user, getIdToken, isLoading });
  useEffect(() => {
    authRef.current = { user, getIdToken, isLoading };
  }, [user, getIdToken, isLoading]);

  // Created on first use from an effect or handler, never during render.
  const outboxRef = useRef<FailureOutbox<OutboxFailure> | null>(null);
  const getOutbox = useCallback(() => {
    outboxRef.current ??= createFailureOutbox<OutboxFailure>({
      storage: browserStorage(),
      send: (batch) =>
        sendOutboxBatch(batch, {
          currentUid: () => authRef.current.user?.uid ?? null,
          getIdToken: () => authRef.current.getIdToken(),
          visitorId: () => getAnonymousVisitorId(browserStorage()),
        }),
    });
    return outboxRef.current;
  }, []);

  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drain = useCallback(async () => {
    const outbox = getOutbox();
    await withOutboxLock(() => outbox.drain());
    return outbox.pending().length;
  }, [getOutbox]);

  // Not reset by later enqueues, so steady activity still drains on the
  // interval instead of postponing it indefinitely. Re-arms itself while
  // anything is left (a failed send), so a retry does not wait for the next
  // failure or the next visit.
  const scheduleDrain = useCallback(() => {
    if (drainTimerRef.current !== null) return;
    const tick = () => {
      drainTimerRef.current = null;
      void drain().then((left) => {
        if (left > 0 && drainTimerRef.current === null) {
          drainTimerRef.current = setTimeout(tick, OUTBOX_DRAIN_INTERVAL_MS);
        }
      });
    };
    drainTimerRef.current = setTimeout(tick, OUTBOX_DRAIN_INTERVAL_MS);
  }, [drain]);

  const drainNow = useCallback(() => {
    if (drainTimerRef.current !== null) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    void drain().then((left) => {
      if (left > 0) scheduleDrain();
    });
  }, [drain, scheduleDrain]);

  const send = useCallback(
    (items: BufferedReport[]) => {
      const failures: OutboxFailure[] = items.map((item) => ({
        ...item.occurrence,
        occurrenceCount: item.occurrenceCount,
        sessionId,
      }));
      const { user: currentUser, isLoading: authLoading } = authRef.current;
      const auth: OutboxAuth = authLoading
        ? { kind: "unknown" }
        : currentUser
          ? { kind: "user", uid: currentUser.uid }
          : { kind: "anonymous", visitorId: getAnonymousVisitorId(browserStorage()) };
      getOutbox().enqueue(failures, auth);
      scheduleDrain();
    },
    [sessionId, getOutbox, scheduleDrain],
  );

  // One buffer for the life of the hook, created on first use from inside an
  // effect or a handler — never during render, where reading a ref is both
  // lint-flagged and genuinely wrong under concurrent rendering. Its identity
  // must be stable: recreating it would lose the high-water marks and count
  // occurrences the user has already been credited with a second time.
  const bufferRef = useRef<ReturnType<typeof createReportBuffer> | null>(null);
  const getBuffer = useCallback(() => {
    bufferRef.current ??= createReportBuffer({ flush: send });
    return bufferRef.current;
  }, [send]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Moves everything in memory into the outbox and sends the outbox now. */
  const flushNow = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // The buffer hands its batch to `send` synchronously, so the outbox
    // already holds it when the drain starts.
    void getBuffer().flushNow();
    drainNow();
  }, [getBuffer, drainNow]);

  // Whatever an earlier visit left queued is sent once the sign-in check has
  // settled, so a batch queued as `unknown` is attributed correctly.
  useEffect(() => {
    if (!isLoading) drainNow();
  }, [isLoading, drainNow]);

  // Timers die with the hook; whatever they were waiting for was drained by
  // the unmount flush below or stays queued for the next visit.
  useEffect(
    () => () => {
      if (drainTimerRef.current !== null) clearTimeout(drainTimerRef.current);
    },
    [],
  );

  // One set of listeners for the life of the hook. `pagehide` rather than
  // `unload`, which is ignored by browsers that keep pages in the back/
  // forward cache; `visibilitychange` catches a tab switched away from and
  // never returned to, which `pagehide` on its own can miss.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onHidden);
      flushNow();
    };
  }, [flushNow]);

  useEffect(() => {
    if (!output) return;
    const { unmappedDetails, sourceSignals } = output.validation;
    if (unmappedDetails.length === 0 && sourceSignals.length === 0) return;

    const meta = {
      source: context.source,
      encodingId: context.encodingId,
      engineVersion: output.engineVersion,
      rulesHash: output.rulesHash,
      fileName: context.fileName,
      fileType: context.fileType,
    };

    // The key spans both kinds, so an ambiguous byte and an unmapped byte
    // with the same sequence stay separate patterns.
    const keyFor = (kind: string, sequence: string) =>
      patternKey(context.encodingId, output.engineVersion, `${kind}:${sequence}`);

    const buffer = getBuffer();
    let buffered = 0;
    for (const detail of unmappedDetails) {
      buffered += buffer.record(
        keyFor("unmapped", detail.sequence),
        buildFailureOccurrence(meta, output.sourceText, detail),
        detail.count,
      );
    }
    for (const signal of sourceSignals) {
      buffered += buffer.record(
        keyFor("ambiguous", signal.sequence),
        buildSignalOccurrence(meta, output.sourceText, signal),
        signal.count,
      );
    }

    if (buffered === 0) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void buffer.flushNow();
    }, FLUSH_DELAY_MS);
    // `context` is a fresh object literal each render, so its fields are
    // listed individually rather than depending on the object identity.
  }, [
    output,
    context.source,
    context.encodingId,
    context.fileName,
    context.fileType,
    getBuffer,
  ]);
}
