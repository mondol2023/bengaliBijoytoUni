import type { SafeErrorResponse } from "@/lib/errors/handlers";
import { AppErrors, err, ok } from "@/lib/errors/types";
import type { AppError, Result } from "@/lib/errors/types";

const ENDPOINT = "/api/ocr/improve";

export interface ImproveClientDeps {
  fetch: typeof fetch;
  getToken(): Promise<string | null>;
}

export interface ImproveReading {
  texts: string[];
  provider: string;
  model: string;
}

export interface ImproveClient {
  /** False on any failure, a 401 included: "is AI on here?" never throws. */
  available(signal?: AbortSignal): Promise<boolean>;
  /** One text per crop, in order. An abort comes back as an error; check `signal.aborted`. */
  improve(crops: readonly Blob[], signal?: AbortSignal): Promise<Result<ImproveReading>>;
}

type ImproveApiResponse =
  | { ok: true; texts: unknown; provider: unknown; model: unknown }
  | { ok: false; error: SafeErrorResponse };

const UNREACHABLE = "Couldn't reach the server.";

export function createImproveClient(deps: ImproveClientDeps): ImproveClient {
  return {
    async available(signal) {
      try {
        const token = await deps.getToken();
        if (!token) return false;
        const response = await deps.fetch(ENDPOINT, { headers: { Authorization: `Bearer ${token}` }, signal });
        const payload = (await response.json()) as { ok?: unknown; available?: unknown };
        return payload.ok === true && payload.available === true;
      } catch {
        return false;
      }
    },

    async improve(crops, signal) {
      const token = await deps.getToken();
      if (!token) return err(AppErrors.authentication("Sign in to improve readings with AI."));
      if (signal?.aborted) return err(AppErrors.unknown("Cancelled."));

      const body = new FormData();
      crops.forEach((crop, index) => body.append(`image-${index}`, crop, "crop.jpg"));

      let payload: ImproveApiResponse;
      try {
        const response = await deps.fetch(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body,
          signal,
        });
        payload = (await response.json()) as ImproveApiResponse;
      } catch {
        return err(AppErrors.unknown(signal?.aborted ? "Cancelled." : UNREACHABLE));
      }

      if (!payload.ok) {
        const { error } = payload;
        // Already stripped of `debug` by the server, so safe to surface; anything malformed is not.
        if (typeof error?.code === "string" && typeof error.message === "string") return err(error as AppError);
        return err(AppErrors.unknown("The AI service sent back an unexpected answer."));
      }

      // The shape is the server's promise, not ours: a misaligned list would put one crop's text on another line.
      const { texts, provider, model } = payload;
      if (
        !Array.isArray(texts) ||
        texts.length !== crops.length ||
        !texts.every((text) => typeof text === "string") ||
        typeof provider !== "string" ||
        typeof model !== "string"
      ) {
        return err(AppErrors.unknown("The AI service sent back an unexpected answer."));
      }
      return ok({ texts: texts as string[], provider, model });
    },
  };
}
