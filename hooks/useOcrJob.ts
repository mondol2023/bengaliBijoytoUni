"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { OCR_PREVIEW_MAX_EDGE_PX } from "@/features/ocr/config";
import type { OcrEngine } from "@/features/ocr/engine/tesseract";
import type { ItemOutcome, OcrWorkItem } from "@/features/ocr/engine/orchestrator";
import { createImproveClient } from "@/features/ocr/fallback/improveClient";
import type { ImproveClient } from "@/features/ocr/fallback/improveClient";
import { pickImproveTargets, runImprovePass } from "@/features/ocr/fallback/improvePass";
import { detectOcrFileKind } from "@/features/ocr/job/fileKind";
import type { OcrFileKind } from "@/features/ocr/job/fileKind";
import { initialOcrJobState, ocrJobReducer } from "@/features/ocr/job/jobState";
import type { OcrJobAction, OcrJobState } from "@/features/ocr/job/jobState";
import type { OcrSource } from "@/features/ocr/job/source";
import type { OcrMode } from "@/features/ocr/types";
import { toAppError, toSafeResponse } from "@/lib/errors/handlers";
import { OCR_AI_LIMITS } from "@/lib/ocr/limits";

type WithoutJobId<T> = T extends unknown ? Omit<T, "jobId"> : never;
type ActionBody = WithoutJobId<Extract<OcrJobAction, { jobId: number }>>;

/** Per-browser preference, not account state. Stored only when switched off: on is the default. */
const IMPROVE_OFF_STORAGE_KEY = "c2u:ocr-improve-off";

const improveListeners = new Set<() => void>();

function readImprovePreference(): boolean {
  try {
    return window.localStorage.getItem(IMPROVE_OFF_STORAGE_KEY) === null;
  } catch {
    return true;
  }
}

function subscribeImprove(listener: () => void) {
  improveListeners.add(listener);
  return () => improveListeners.delete(listener);
}

const improveServerSnapshot = () => true;

function writeImprovePreference(enabled: boolean) {
  try {
    if (enabled) window.localStorage.removeItem(IMPROVE_OFF_STORAGE_KEY);
    else window.localStorage.setItem(IMPROVE_OFF_STORAGE_KEY, "1");
  } catch {
    // Private mode or blocked storage: the switch keeps its default, which the label shows.
  }
  improveListeners.forEach((listener) => listener());
}

/**
 * Runs one OCR job at a time in the browser and exposes it as reducer state.
 * pdf.js, JSZip and tesseract.js arrive through `import()` on the first start.
 */
export function useOcrJob(): {
  state: OcrJobState;
  file: File | null;
  setFile(file: File | null): void;
  mode: OcrMode;
  setMode(mode: OcrMode): void;
  fileKind: OcrFileKind | null;
  start(): void;
  cancel(): void;
  reset(): void;
  /** Null until the server has answered; false when signed out or AI is off on this deployment. */
  improveAvailable: boolean | null;
  improveEnabled: boolean;
  setImproveEnabled(enabled: boolean): void;
  /** Re-reads one line with AI. Stable identity: `OcrResultRow` is memoised. */
  improveOne(id: string): void;
} {
  const [state, dispatch] = useReducer(ocrJobReducer, initialOcrJobState);
  const [file, setFileState] = useState<File | null>(null);
  const [mode, setMode] = useState<OcrMode>("embedded");
  const [fileKind, setFileKind] = useState<OcrFileKind | null>(null);

  const { user, getIdToken } = useAuth();
  const improveEnabled = useSyncExternalStore(subscribeImprove, readImprovePreference, improveServerSnapshot);
  const client = useMemo<ImproveClient>(
    () => createImproveClient({ fetch: (input, init) => fetch(input, init), getToken: getIdToken }),
    [getIdToken],
  );
  // The answer is tied to the account it was asked for, so signing out or switching accounts reads as "not yet known".
  const [availability, setAvailability] = useState<{ uid: string; available: boolean } | null>(null);
  const improveAvailable = !user ? false : availability?.uid === user.uid ? availability.available : null;

  // The reducer drops late actions, so it cannot own what must be released: the hook keeps its
  // own record of every URL it made, and of which job is current.
  const jobIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const engineRef = useRef<OcrEngine | null>(null);
  const fileRef = useRef<File | null>(null);
  /** Item id -> preview blob URL: the image a line is re-read from. Released with `urlsRef`. */
  const previewsRef = useRef<Map<string, string>>(new Map());
  // Read through refs so `runJob` and `improveOne` keep a stable identity.
  const clientRef = useRef(client);
  const improveEnabledRef = useRef(improveEnabled);
  const improveAvailableRef = useRef(improveAvailable);
  const stateRef = useRef(state);
  useEffect(() => {
    clientRef.current = client;
    improveEnabledRef.current = improveEnabled;
    improveAvailableRef.current = improveAvailable;
    stateRef.current = state;
  });

  const revokeAll = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    previewsRef.current.clear();
  }, []);

  const disposeEngine = useCallback(() => {
    const engine = engineRef.current;
    engineRef.current = null;
    void engine?.dispose().catch(() => {});
  }, []);

  /** Ends whatever is running and makes every in-flight continuation stale. */
  const invalidate = useCallback(() => {
    jobIdRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    revokeAll();
  }, [revokeAll]);

  useEffect(
    () => () => {
      invalidate();
      disposeEngine();
    },
    [invalidate, disposeEngine],
  );

  // "Is AI on here?" spends no provider call, but it needs a signed-in caller, so it is only asked then.
  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    const controller = new AbortController();
    void client.available(controller.signal).then((available) => {
      if (!controller.signal.aborted) setAvailability({ uid, available });
    });
    return () => controller.abort();
  }, [user, client]);

  const setFile = useCallback((next: File | null) => {
    fileRef.current = next;
    setFileState(next);
    setFileKind(null);
    if (!next) return;
    void next
      .slice(0, 8)
      .arrayBuffer()
      .then((head) => {
        if (fileRef.current !== next) return;
        const kind = detectOcrFileKind(next.name, new Uint8Array(head));
        setFileKind(kind.ok ? kind.value : null);
      })
      .catch(() => {});
  }, []);

  /** The preview blob for a line, or null when there is nothing sendable (missing, or over the size cap). */
  const loadCrop = useCallback(async (id: string): Promise<Blob | null> => {
    const url = previewsRef.current.get(id);
    if (!url) return null;
    try {
      const blob = await (await fetch(url)).blob();
      return blob.size > OCR_AI_LIMITS.maxImageBytes ? null : blob;
    } catch {
      return null;
    }
  }, []);

  /** Runs the improve pass for `ids` under `jobId`, then clears whatever is still marked running. */
  const improve = useCallback(
    async (jobId: number, ids: string[], pass: boolean, signal: AbortSignal) => {
      const send = (action: ActionBody) => {
        if (jobIdRef.current === jobId) dispatch({ ...action, jobId } as OcrJobAction);
      };
      send({ type: "improveStarted", ids, pass });
      try {
        await runImprovePass(ids, {
          client: clientRef.current,
          loadCrop,
          onUpdate: (id, update) => send({ type: "improveUpdate", id, state: update }),
          signal,
        });
      } finally {
        send({ type: "improveFinished" });
      }
    },
    [loadCrop],
  );

  const runJob = useCallback(
    async (jobId: number, target: File, jobMode: OcrMode, controller: AbortController) => {
      const { signal } = controller;
      const isCurrent = () => jobIdRef.current === jobId;
      const send = (action: ActionBody) => {
        if (isCurrent()) dispatch({ ...action, jobId } as OcrJobAction);
      };
      /** Registers a URL; if the job went stale while it was being made, it is released at once. */
      const adopt = (url: string): boolean => {
        if (!isCurrent()) {
          URL.revokeObjectURL(url);
          return false;
        }
        urlsRef.current.add(url);
        return true;
      };

      let source: OcrSource | null = null;
      const pendingPreviews = new Set<Promise<void>>();
      try {
        const bytes = new Uint8Array(await target.arrayBuffer());
        const kind = detectOcrFileKind(target.name, bytes.subarray(0, 8));
        if (!kind.ok) return send({ type: "failed", error: toSafeResponse(kind.error) });

        const runtime = (await import("@/features/ocr/job/browserRuntime")).browserOcrRuntime;
        if (!isCurrent()) return;

        const prepared = await runtime.prepare(bytes, kind.value, jobMode, {
          canvas: runtime.canvas,
          pdf: runtime.pdf,
          signal,
        });
        if (!prepared.ok) {
          return signal.aborted
            ? send({ type: "finished", cancelled: true })
            : send({ type: "failed", error: toSafeResponse(prepared.error) });
        }
        const activeSource = prepared.value;
        source = activeSource;
        if (!isCurrent()) return;

        send({
          type: "sourceReady",
          items: activeSource.items.map(({ id, label, page, box }) => ({ id, label, page, box })),
          pages: activeSource.pages,
          skipped: activeSource.skipped,
          unreadable: activeSource.unreadable,
        });

        const pagesSeen = new Set<number>();

        /** Runs off the read path; a failed preview costs nothing but the picture. */
        const fireTask = (run: () => Promise<void>) => {
          const task: Promise<void> = run()
            .catch(() => {})
            .finally(() => pendingPreviews.delete(task));
          pendingPreviews.add(task);
        };

        const firePagePreview = (page: number, render: NonNullable<OcrSource["renderPagePreview"]>) =>
          fireTask(async () => {
            const rendered = await render(page);
            if (!rendered.ok || !isCurrent()) return;
            const url = await runtime.toPreviewUrl(rendered.value, OCR_PREVIEW_MAX_EDGE_PX);
            if (adopt(url)) send({ type: "pagePreview", page, url });
          });

        const workItems: OcrWorkItem[] = activeSource.items.map((item) => ({
          id: item.id,
          async load() {
            if (!isCurrent()) return null;
            send({ type: "itemStarted", id: item.id });
            const image = await item.load();
            if (!image || !isCurrent()) return image;

            const page = item.page;
            const isNewPage = page !== null && !pagesSeen.has(page);
            if (isNewPage) pagesSeen.add(page);
            // Not awaited: encoding the picture must not hold up the next item's decode.
            fireTask(async () => {
              const url = await runtime.toPreviewUrl(image, OCR_PREVIEW_MAX_EDGE_PX);
              if (adopt(url)) {
                previewsRef.current.set(item.id, url);
                send({ type: "preview", id: item.id, url });
                // In whole-page mode the item is the page, so its preview is the page preview.
                if (isNewPage && jobMode === "pages") send({ type: "pagePreview", page, url });
              }
            });
            if (isNewPage && jobMode !== "pages" && activeSource.renderPagePreview) {
              firePagePreview(page, activeSource.renderPagePreview);
            }
            return image;
          },
        }));

        const { runOcrJob } = await import("@/features/ocr/engine/orchestrator");
        if (!isCurrent()) return;
        const engine = (engineRef.current ??= runtime.createEngine());
        let warmFailed = false;
        const watched: OcrEngine = {
          recognize: (image, lang) => engine.recognize(image, lang),
          dispose: () => engine.dispose(),
          async warmUp(lang) {
            let result;
            try {
              result = await engine.warmUp(lang);
            } catch (cause) {
              warmFailed = true;
              throw cause;
            }
            if (result.ok) send({ type: "warmed" });
            else warmFailed = true;
            return result;
          },
        };

        const finishedOutcomes: ItemOutcome[] = [];
        const result = await runOcrJob(workItems, watched, {
          signal,
          onItem: (outcome) => {
            finishedOutcomes.push(outcome);
            send({ type: "itemDone", outcome });
          },
        });
        if (!result.ok) {
          // The engine's start circuit breaker lasts for its lifetime, so the next try needs a new one.
          if (warmFailed && isCurrent() && engineRef.current === engine) disposeEngine();
          return signal.aborted
            ? send({ type: "finished", cancelled: true })
            : send({ type: "failed", error: toSafeResponse(result.error) });
        }
        const { cancelled } = result.value;
        send({ type: "finished", cancelled });

        // The automatic pass. `improveStarted` follows `finished` in the same tick, so React batches
        // the two and the sheet never flashes "done". The job's controller stays registered until
        // `finally`, so Cancel still works.
        if (!cancelled && improveEnabledRef.current && improveAvailableRef.current === true) {
          const order = new Map(activeSource.items.map((item, index) => [item.id, index]));
          const ids = pickImproveTargets(finishedOutcomes, OCR_AI_LIMITS.maxImagesPerJob).sort(
            (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
          );
          if (ids.length > 0) {
            // The crops are the previews, so wait for the last of them to be encoded.
            await Promise.allSettled([...pendingPreviews]);
            await improve(jobId, ids, true, signal);
          }
        }
      } catch (cause) {
        send({ type: "failed", error: toSafeResponse(toAppError(cause, "Text recognition failed. Please try again.")) });
      } finally {
        // runOcrJob has settled every in-flight item by now; only fire-and-forget page renders remain.
        await Promise.allSettled([...pendingPreviews]);
        try {
          await source?.dispose();
        } catch {
          // Releasing the document is best effort.
        }
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [disposeEngine, improve],
  );

  const start = useCallback(() => {
    const target = fileRef.current;
    if (!target) return;
    invalidate();
    const jobId = jobIdRef.current; // invalidate() just advanced it
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "start", jobId });
    void runJob(jobId, target, mode, controller);
  }, [invalidate, mode, runJob]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    invalidate();
    dispatch({ type: "reset" });
  }, [invalidate]);

  const improveOne = useCallback(
    (id: string) => {
      // One request at a time: a running job, a pass or another line already owns the controller.
      if (controllerRef.current) return;
      if (!improveEnabledRef.current || improveAvailableRef.current !== true) return;
      const current = stateRef.current;
      if (current.outcomes[id]?.status !== "done" || current.improvements[id]?.status === "done") return;

      const controller = new AbortController();
      controllerRef.current = controller;
      void improve(jobIdRef.current, [id], false, controller.signal).finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
      });
    },
    [improve],
  );

  return {
    state,
    file,
    setFile,
    mode,
    setMode,
    fileKind,
    start,
    cancel,
    reset,
    improveAvailable,
    improveEnabled,
    setImproveEnabled: writeImprovePreference,
    improveOne,
  };
}
