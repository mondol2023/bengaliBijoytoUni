import { forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A text micro-control ("Clear", "Load sample", "Download") — the mono,
 * keyline-underlined control from the proof slip. Use it for secondary
 * actions on a sheet; the one filled `Button` on a sheet stays the primary.
 */
export const MicroButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }
>(function MicroButton({ icon, className, children, type = "button", ...props }, ref) {
  return (
    <button ref={ref} type={type} className={cn("micro-control", className)} {...props}>
      {icon}
      {children}
    </button>
  );
});
