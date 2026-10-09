"use client";

import { useId } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * "Improve hard lines with AI", in the mode toggle's chip styling over a visually hidden checkbox so the
 * keyboard and screen readers get a real control. It is the master switch: off means no automatic pass
 * and no per-line button, which is what keeps the privacy note true.
 */
export function OcrImproveToggle({
  checked,
  onChange,
  signedIn,
  authLoading,
  available,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  signedIn: boolean;
  /** Sign-in state is not known yet: stay quiet rather than say "Sign in". */
  authLoading: boolean;
  /** Null until the server has answered. */
  available: boolean | null;
  /** A pass or a line is being re-read right now. */
  disabled?: boolean;
}) {
  const hintId = useId();
  const usable = signedIn && available === true;
  const hint = authLoading
    ? null
    : !signedIn
      ? "Sign in to use this"
      : available === false
        ? "Not enabled on this deployment"
        : null;
  const off = disabled || !usable;
  const on = usable && checked;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label
        className={cn(
          "inline-flex min-h-9 items-center gap-2 rounded-sm border px-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-colors",
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
          on ? "border-border bg-accent-muted text-accent" : "border-transparent text-foreground",
          off ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:text-accent",
        )}
      >
        <input
          type="checkbox"
          checked={on}
          disabled={off}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="sr-only"
        />
        Improve hard lines with AI
      </label>
      {hint && (
        <span id={hintId} className="text-xs text-foreground/60">
          {hint}
        </span>
      )}
    </div>
  );
}
