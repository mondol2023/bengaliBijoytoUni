"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function CopyButton({
  text,
  disabled,
  className,
  variant = "secondary",
  label = "Copy",
}: {
  text: string;
  disabled?: boolean;
  className?: string;
  /** `primary` on an output sheet, where taking the result is the point of the page. */
  variant?: "primary" | "secondary";
  /** Idle button text; the copied state always reads "Copied". */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable or permission denied — fail silently.
    }
  }

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={handleCopy}
      disabled={disabled || text.length === 0}
      className={className}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}
