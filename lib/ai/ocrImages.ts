/**
 * Reads cropped images of text with an AI vision provider: the fallback for
 * lines the in-browser Tesseract pass read poorly (`/ocr`).
 *
 * What it is not: a source of truth. The result is shown beside the local
 * reading, labelled as AI output, and goes nowhere else.
 *
 * The providers form an ordered chain (`registry.ts#getOcrProviders`). Each
 * has its own switch, key, model and daily call budget. The chain moves on
 * only when the failure says *this provider, right now* — rate limited,
 * unavailable, timed out, or its budget spent — and never silently: the
 * result names the provider that answered. A rejected credential, a response
 * that could not be read, or content the provider declined stops the walk and
 * is reported, because trying elsewhere would hide a broken deployment.
 *
 * One request is one call per provider tried: no retries, and a budget unit is
 * taken before each call, atomically, in the shared counter.
 */
import { assertServerOnly } from "./assertServerOnly";

assertServerOnly("lib/ai/ocrImages.ts");

import { getOcrProviders } from "./registry";
import { providerErrorToAppError, type ProviderError } from "./errors";
import type { OcrImageInput, OcrImageProvider, OcrImagesResult, ProviderId, ProviderResult } from "./types";
import { createOcrCallBudget, type OcrCallBudget } from "@/lib/ocr/budget";
import { OCR_AI_LIMITS } from "@/lib/ocr/limits";
import { firestoreCounterStore } from "@/lib/firebase/sharedCounter";
import { AppErrors, err, ok, type Result } from "../errors/types";

const productionBudgets: Partial<Record<ProviderId, OcrCallBudget>> = {};

function productionBudgetFor(id: ProviderId): OcrCallBudget {
  return (productionBudgets[id] ??= createOcrCallBudget({ provider: id, store: firestoreCounterStore }));
}

export interface OcrImagesDeps {
  readonly providers?: () => ProviderResult<OcrImageProvider[]>;
  readonly budgetFor?: (id: ProviderId) => OcrCallBudget;
}

/** True for the failures that mean "not this provider, not now". */
export function shouldTryNextProvider(error: ProviderError): boolean {
  switch (error.code) {
    case "provider_rate_limited":
    case "provider_unavailable":
    case "provider_timeout":
    case "provider_budget_exhausted":
      return true;
    default:
      return false;
  }
}

export async function readOcrImages(
  images: readonly OcrImageInput[],
  deps: OcrImagesDeps = {},
): Promise<Result<OcrImagesResult>> {
  const lookup = (deps.providers ?? getOcrProviders)();
  if (!lookup.ok) return err(providerErrorToAppError(lookup.error));

  if (images.length < 1 || images.length > OCR_AI_LIMITS.maxImagesPerRequest) {
    return err(
      AppErrors.validation(`Send between 1 and ${OCR_AI_LIMITS.maxImagesPerRequest} images at a time.`),
    );
  }

  // Checked before any budget is touched, so an unconfigured deployment never spends a unit.
  const candidates = lookup.value.filter((provider) => provider.isConfigured());
  if (candidates.length === 0) {
    return err(AppErrors.unknown("AI text reading is not set up on this deployment."));
  }

  const budgetFor = deps.budgetFor ?? productionBudgetFor;
  let firstError: ProviderError | null = null;
  for (const provider of candidates) {
    const reservation = await budgetFor(provider.id).reserve();
    if (!reservation.ok) {
      firstError ??= reservation.error;
      if (shouldTryNextProvider(reservation.error)) continue;
      return err(providerErrorToAppError(firstError));
    }

    const result = await provider.readImages(images, { timeoutMs: OCR_AI_LIMITS.providerTimeoutMs });
    if (result.ok) return ok(result.value);
    firstError ??= result.error;
    if (!shouldTryNextProvider(result.error)) return err(providerErrorToAppError(result.error));
  }
  // Non-null: the loop ran at least once and every path through it that reaches here set it.
  return err(providerErrorToAppError(firstError!));
}

/**
 * Whether the page should offer AI reading at all: a provider's switch is on
 * and it has what it needs. Reads configuration only — no call, no budget.
 */
export async function isOcrAiAvailable(
  deps: Pick<OcrImagesDeps, "providers"> = {},
): Promise<boolean> {
  const lookup = (deps.providers ?? getOcrProviders)();
  return lookup.ok && lookup.value.some((provider) => provider.isConfigured());
}
