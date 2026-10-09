/**
 * The sequential AI improve pass: pure orchestration over an injected client and
 * crop loader, so the hook owns React, `fetch` and blob URLs.
 */
import { OCR_AI_LIMITS } from "@/lib/ocr/limits";
import type { DoneOutcome, ItemOutcome } from "../engine/orchestrator";
import { planBatches } from "./batching";
import type { ImproveClient } from "./improveClient";

export type ImproveState =
  | { status: "running" }
  | { status: "done"; text: string; provider: string; model: string }
  | { status: "failed"; message: string };

export interface ImprovePassDeps {
  client: Pick<ImproveClient, "improve">;
  /** The preview blob. Null means nothing sendable: missing, or over `maxImageBytes`. */
  loadCrop(id: string): Promise<Blob | null>;
  onUpdate(id: string, state: ImproveState): void;
  signal?: AbortSignal;
}

export type ImproveStop = "done" | "aborted" | "auth" | "rate-limit" | "unavailable" | "errors";

const TOO_LARGE = "This line is too large to send.";
const OVER_JOB_CAP = "Too many lines for one pass. This one kept its local reading.";
const SIGN_IN_AGAIN = "Sign in again to continue.";
const FAILED_BATCHES_IN_A_ROW = 2;

/** Lines Tesseract flagged, weakest first. An empty reading counts as confidence 0. */
export function pickImproveTargets(outcomes: readonly ItemOutcome[], max: number): string[] {
  return outcomes
    .filter((outcome): outcome is DoneOutcome => outcome.status === "done" && outcome.fallback.needed)
    .map((outcome) => ({ id: outcome.id, confidence: outcome.text.trim() === "" ? 0 : outcome.confidence }))
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, Math.max(0, max))
    .map((target) => target.id);
}

function stopFor(code: string, failedInARow: number): Exclude<ImproveStop, "done" | "aborted"> | null {
  switch (code) {
    case "AUTHENTICATION_ERROR":
      return "auth";
    case "RATE_LIMIT_ERROR":
      return "rate-limit";
    // The route answers these when AI is switched off or this account may not use it.
    case "NOT_FOUND_ERROR":
    case "AUTHORIZATION_ERROR":
      return "unavailable";
    default:
      return failedInARow >= FAILED_BATCHES_IN_A_ROW ? "errors" : null;
  }
}

/**
 * Sends `ids` (already in page order) one batch at a time. Every id ends `done`
 * or `failed`, except on an abort: that emits nothing more, and the reducer's
 * `improveFinished` clears whatever is still `running`.
 */
export async function runImprovePass(
  ids: readonly string[],
  deps: ImprovePassDeps,
): Promise<{ stoppedBy: ImproveStop }> {
  const { client, loadCrop, onUpdate, signal } = deps;
  const aborted = { stoppedBy: "aborted" } as const;
  if (signal?.aborted) return aborted;

  const crops = new Map<string, Blob>();
  for (const id of ids) {
    const crop = await loadCrop(id);
    if (signal?.aborted) return aborted;
    if (crop === null) onUpdate(id, { status: "failed", message: TOO_LARGE });
    else crops.set(id, crop);
  }

  const { batches, deferred } = planBatches(
    [...crops].map(([id, blob]) => ({ id, bytes: blob.size })),
    OCR_AI_LIMITS,
  );
  for (const id of deferred) onUpdate(id, { status: "failed", message: OVER_JOB_CAP });

  let failedInARow = 0;
  for (const [index, batch] of batches.entries()) {
    if (signal?.aborted) return aborted;
    const result = await client.improve(
      batch.map((id) => crops.get(id) as Blob),
      signal,
    );
    // A late answer belongs to a job the user has already left.
    if (signal?.aborted) return aborted;

    if (result.ok) {
      failedInARow = 0;
      const { texts, provider, model } = result.value;
      batch.forEach((id, position) =>
        onUpdate(id, { status: "done", text: texts[position] as string, provider, model }),
      );
      continue;
    }

    const { code, message } = result.error;
    for (const id of batch) onUpdate(id, { status: "failed", message });
    failedInARow++;
    const stoppedBy = stopFor(code, failedInARow);
    if (stoppedBy !== null) {
      const unsent = batches.slice(index + 1).flat();
      for (const id of unsent) {
        onUpdate(id, { status: "failed", message: stoppedBy === "auth" ? SIGN_IN_AGAIN : message });
      }
      return { stoppedBy };
    }
  }
  return { stoppedBy: "done" };
}
