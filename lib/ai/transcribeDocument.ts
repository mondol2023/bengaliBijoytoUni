/**
 * Whole-document AI transcription: the fallback for documents the
 * deterministic engine cannot convert well (`features/documents/quality.ts`).
 *
 * What it is not: a source of mapping rules. Its output is shown to the user
 * beside the engine's, labelled as AI output, and goes nowhere else — not
 * into `encodings/*`, not into the known-patterns snapshot, not into the
 * conversion-failure collections. The deterministic path stays the only
 * thing that decides how a legacy byte converts.
 *
 * Cost control, in the order a request meets it: the deployment switch
 * (`AI_TRANSCRIPTION_ENABLED`, in the registry), the route's per-caller rate
 * limit, then the deployment-wide daily call budget shared with resolution
 * (`costCap.ts`). One request is one call: no retries, because a retried
 * whole-document call is the most expensive thing this app could repeat,
 * and a timeout on a long document is not a statement about "now".
 */
import { assertServerOnly } from "./assertServerOnly";

assertServerOnly("lib/ai/transcribeDocument.ts");

import { getTranscriptionProvider } from "./registry";
import { createDailyCallBudget } from "./costCap";
import { providerErrorToAppError } from "./errors";
import { TRANSCRIPTION_LIMITS } from "./limits";
import type { DocumentTranscription, DocumentTranscriptionRequest } from "./types";
import { firestoreCounterStore } from "@/lib/firebase/sharedCounter";
import { AppErrors, err, ok, type Result } from "../errors/types";

const dailyCallBudget = createDailyCallBudget({ store: firestoreCounterStore });

export async function transcribeDocument(
  request: DocumentTranscriptionRequest,
): Promise<Result<DocumentTranscription>> {
  const lookup = getTranscriptionProvider();
  if (!lookup.ok) return err(providerErrorToAppError(lookup.error));
  const provider = lookup.value;

  if (!request.file && !request.text?.trim()) {
    return err(AppErrors.validation("There is nothing in this document to transcribe."));
  }
  if (request.file && request.file.data.byteLength > TRANSCRIPTION_LIMITS.maxInlineFileBytes) {
    return err(
      AppErrors.fileProcessing("This file is too large for AI transcription.", {
        details: { fileName: request.fileName, fileType: "pdf", reason: "too_large" },
      }),
    );
  }
  // Checked before the budget so an unconfigured deployment never spends a unit.
  if (!provider.isConfigured()) {
    return err(AppErrors.unknown("AI transcription is not set up on this deployment."));
  }

  const reservation = await dailyCallBudget.reserve();
  if (!reservation.ok) return err(providerErrorToAppError(reservation.error));

  const result = await provider.transcribe(request);
  if (!result.ok) return err(providerErrorToAppError(result.error));
  return ok(result.value);
}
