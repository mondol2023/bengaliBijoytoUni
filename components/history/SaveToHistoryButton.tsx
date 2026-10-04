"use client";

import { useState } from "react";
import { Check, History, Loader2 } from "lucide-react";
import { MicroButton } from "@/components/ui/MicroButton";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

/**
 * Generic "save this result to my history" action. Callers own the actual
 * fetch (each of `/api/conversions` and `/api/comparisons` has its own body
 * shape) — this just owns the idle/saving/saved/error presentation so it
 * isn't duplicated between the converter and comparison workspaces.
 */
export function SaveToHistoryButton({
  onSave,
  disabled,
}: {
  onSave: () => Promise<SafeErrorResponse | null>;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setStatus("saving");
    setError(null);
    const result = await onSave();
    if (result) {
      setError(result.message);
      setStatus("error");
      return;
    }
    setStatus("saved");
  }

  return (
    <div className="flex items-center gap-2">
      <MicroButton
        onClick={handleClick}
        disabled={disabled || status === "saving"}
        icon={
          status === "saving" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : status === "saved" ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <History className="h-3.5 w-3.5" aria-hidden />
          )
        }
      >
        {status === "saved" ? "Saved" : "Save"}
      </MicroButton>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
