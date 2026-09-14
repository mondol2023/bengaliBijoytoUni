"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motionTokens, springs } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils/cn";

/**
 * Shared modal shell. Radix supplies the accessibility contract (focus trap,
 * Escape-to-close, overlay click, `role="dialog"`/`aria-modal`); this wraps
 * it with the app's `AnimatePresence` enter/exit per the `motion-patterns`
 * skill's Modal pattern. `forceMount` on both layers keeps them in the tree
 * for AnimatePresence to animate their exit before Radix unmounts them.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount key="dialog">
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionTokens.duration.fast }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                className={cn(
                  "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2",
                  "rounded-lg border border-border bg-surface p-6 shadow-lg focus:outline-none",
                  className,
                )}
                initial={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: motionTokens.scale.subtle, y: motionTokens.distance.sm }
                }
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: motionTokens.scale.subtle, y: motionTokens.distance.sm }
                }
                transition={springs.gentle}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
                      {title}
                    </DialogPrimitive.Title>
                    {description && (
                      <DialogPrimitive.Description className="mt-1 text-sm text-foreground/60">
                        {description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                  <DialogPrimitive.Close asChild>
                    <button
                      type="button"
                      className="rounded-md p-1 text-foreground/50 hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </DialogPrimitive.Close>
                </div>
                {children}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
