"use client";

import { useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAdminConfig } from "@/hooks/useAdminConfig";
import { listTiers } from "@/features/usage/tierConfig";
import type { SystemConfig } from "@/lib/firebase/schemas";
import type { TierId } from "@/types/domain";

interface FormState {
  tierOverrides: Record<TierId, string>;
  enabledEncodings: Set<string>;
  maxUploadSizeMB: string;
  documentsEnabled: boolean;
  comparisonEnabled: boolean;
}

function toFormState(config: SystemConfig, availableEncodingIds: string[]): FormState {
  return {
    tierOverrides: {
      easy: config.tierOverrides.easy?.maxNonWhitespaceChars.toString() ?? "",
      medium: config.tierOverrides.medium?.maxNonWhitespaceChars.toString() ?? "",
      expert: config.tierOverrides.expert?.maxNonWhitespaceChars.toString() ?? "",
    },
    // No `enabledEncodings` override means "all enabled" — represented the same way here.
    enabledEncodings: new Set(config.enabledEncodings ?? availableEncodingIds),
    maxUploadSizeMB: config.maxUploadSizeBytes ? (config.maxUploadSizeBytes / (1024 * 1024)).toString() : "",
    documentsEnabled: config.featureFlags?.documentsEnabled ?? true,
    comparisonEnabled: config.featureFlags?.comparisonEnabled ?? true,
  };
}

export function AdminConfigForm() {
  const { config, availableEncodings, isLoading, error, save, refresh } = useAdminConfig();
  const [form, setForm] = useState<FormState | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seeds the editable form from the loaded config exactly once per load —
  // React's "adjusting state when a prop changes" pattern (see
  // AuthProvider.tsx), not a setState call inside an effect.
  const [seededFrom, setSeededFrom] = useState<SystemConfig | null>(null);
  if (config && config !== seededFrom) {
    setSeededFrom(config);
    setForm(toFormState(config, availableEncodings.map((e) => e.id)));
  }

  if (isLoading || !form) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground/50">
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  }

  async function handleSave() {
    if (!form) return;
    setSaveState("saving");
    setSaveError(null);

    const tierOverrides = {
      easy: form.tierOverrides.easy.trim() === "" ? null : { maxNonWhitespaceChars: Number(form.tierOverrides.easy) },
      medium: form.tierOverrides.medium.trim() === "" ? null : { maxNonWhitespaceChars: Number(form.tierOverrides.medium) },
      expert: form.tierOverrides.expert.trim() === "" ? null : { maxNonWhitespaceChars: Number(form.tierOverrides.expert) },
    };
    const maxUploadSizeBytes =
      form.maxUploadSizeMB.trim() === "" ? undefined : Math.round(Number(form.maxUploadSizeMB) * 1024 * 1024);

    const result = await save({
      tierOverrides,
      enabledEncodings: Array.from(form.enabledEncodings),
      maxUploadSizeBytes,
      featureFlags: { documentsEnabled: form.documentsEnabled, comparisonEnabled: form.comparisonEnabled },
    });

    if (result) {
      setSaveState("error");
      setSaveError(result.message);
    } else {
      setSaveState("saved");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">System config</h2>
        <Button variant="ghost" size="sm" onClick={refresh} leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}>
          Reload
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-foreground/80">Tier limit overrides</h3>
        <p className="text-xs text-foreground/50">Leave blank to use the built-in default for that tier.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {listTiers().map((tier) => (
            <label key={tier.id} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">
                {tier.label} <span className="text-foreground/40">(default {tier.maxNonWhitespaceChars.toLocaleString()})</span>
              </span>
              <input
                type="number"
                min={1}
                value={form.tierOverrides[tier.id]}
                onChange={(event) =>
                  setForm((current) =>
                    current ? { ...current, tierOverrides: { ...current.tierOverrides, [tier.id]: event.target.value } } : current,
                  )
                }
                placeholder="default"
                className="h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-foreground/80">Enabled encodings</h3>
        <div className="flex flex-wrap gap-3">
          {availableEncodings.map((encoding) => (
            <label key={encoding.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabledEncodings.has(encoding.id)}
                onChange={(event) =>
                  setForm((current) => {
                    if (!current) return current;
                    const next = new Set(current.enabledEncodings);
                    if (event.target.checked) next.add(encoding.id);
                    else next.delete(encoding.id);
                    return { ...current, enabledEncodings: next };
                  })
                }
              />
              {encoding.name}
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-foreground/80">Upload size cap</h3>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Max upload size (MB)</span>
          <input
            type="number"
            min={1}
            value={form.maxUploadSizeMB}
            onChange={(event) => setForm((current) => (current ? { ...current, maxUploadSizeMB: event.target.value } : current))}
            placeholder="15 (default)"
            className="h-9 w-40 rounded-md border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-foreground/80">Feature flags</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.documentsEnabled}
            onChange={(event) => setForm((current) => (current ? { ...current, documentsEnabled: event.target.checked } : current))}
          />
          Document uploads enabled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.comparisonEnabled}
            onChange={(event) => setForm((current) => (current ? { ...current, comparisonEnabled: event.target.checked } : current))}
          />
          Comparison tool enabled
        </label>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={() => void handleSave()} loading={saveState === "saving"} leftIcon={<Save className="h-4 w-4" aria-hidden />}>
          Save changes
        </Button>
        {saveState === "saved" && <span className="text-sm text-success">Saved.</span>}
        {saveState === "error" && saveError && <span className="text-sm text-danger">{saveError}</span>}
      </div>
    </div>
  );
}
