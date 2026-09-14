"use client";

import { forwardRef } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { springs, motionTokens } from "@/lib/motion/tokens";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

/**
 * `motion.button` and native button attrs both declare `onDrag`/`onAnimation*`
 * with incompatible signatures — omit the ones we don't need so the two prop
 * sets don't collide under `...props`.
 */
type NativeButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"
>;

export interface ButtonProps extends NativeButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:brightness-110 focus-visible:ring-accent",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-surface-muted focus-visible:ring-accent",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted focus-visible:ring-accent",
  danger: "bg-danger text-danger-foreground hover:brightness-110 focus-visible:ring-danger",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, leftIcon, rightIcon, className, children, disabled, ...props },
  ref,
) {
  const reducedMotion = usePrefersReducedMotion();
  const isDisabled = disabled || loading;

  return (
    <motion.button
      ref={ref}
      disabled={isDisabled}
      whileHover={reducedMotion || isDisabled ? undefined : { scale: motionTokens.scale.pop }}
      whileTap={reducedMotion || isDisabled ? undefined : { scale: motionTokens.scale.press }}
      transition={springs.snappy}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </motion.button>
  );
});
