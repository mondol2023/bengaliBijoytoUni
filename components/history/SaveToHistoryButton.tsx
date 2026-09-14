"use client";

import { useState } from "react";
import { Check, History } from "lucide-react";
import { Button } from "@/components/ui/Button";
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
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        disabled={disabled || status === "saving"}
        loading={status === "saving"}
        leftIcon={status === "saved" ? <Check className="h-4 w-4" aria-hidden /> : <History className="h-4 w-4" aria-hidden />}
      >
        {status === "saved" ? "Saved" : "Save to history"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
