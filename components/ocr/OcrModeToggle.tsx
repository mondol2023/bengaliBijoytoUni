"use client";

import { useId } from "react";
import type { OcrFileKind } from "@/features/ocr/job/fileKind";
import { isModeAvailable } from "@/features/ocr/job/source";
import type { OcrMode } from "@/features/ocr/types";
import { cn } from "@/lib/utils/cn";

const OPTIONS: { value: OcrMode; label: string }[] = [
  { value: "embedded", label: "Embedded images" },
  { value: "pages", label: "Whole pages" },
];

/** Encoding-chip styling over visually hidden radios, so the keyboard and screen readers get a real radio group. */
export function OcrModeToggle({
  mode,
  onChange,
  fileKind,
  disabled,
}: {
  mode: OcrMode;
  onChange: (mode: OcrMode) => void;
  fileKind: OcrFileKind | null;
  disabled?: boolean;
}) {
  const name = useId();
  const hintId = useId();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="plate-marker" id={`${name}-label`}>
        Read
      </span>
      <div role="radiogroup" aria-labelledby={`${name}-label`} className="flex flex-wrap items-center gap-1">
        {OPTIONS.map(({ value, label }) => {
          const unavailable = fileKind !== null && !isModeAvailable(fileKind, value);
          const off = disabled || unavailable;
          const selected = mode === value;
          return (
            <label
              key={value}
              className={cn(
                "inline-flex min-h-9 items-center rounded-sm border px-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                selected ? "border-border bg-accent-muted text-accent" : "border-transparent text-foreground",
                off ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:text-accent",
              )}
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={selected}
                disabled={off}
                aria-describedby={unavailable ? hintId : undefined}
                onChange={() => onChange(value)}
                className="sr-only"
              />
              {label}
            </label>
          );
        })}
      </div>
      {fileKind === "docx" && (
        <span id={hintId} className="text-xs text-foreground/60">
          Whole pages works on PDFs
        </span>
      )}
    </div>
  );
}
