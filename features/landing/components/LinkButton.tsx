import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Navigation styled as an action. `components/ui/Button` is a `motion.button`
 * and cannot be an anchor, and a link that renders as a button still has to
 * be a link for middle-click, copy-link, and screen readers. Hover/press
 * motion is CSS here so the global reduced-motion rule flattens it without a
 * client component.
 */
export function LinkButton({
  href,
  variant = "primary",
  children,
  className,
}: {
  href: string;
  variant?: "primary" | "quiet";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-[transform,background-color,color] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "hover:scale-[1.02] active:scale-[0.98]",
        variant === "primary"
          ? "h-11 bg-accent px-5 text-accent-foreground hover:brightness-110"
          : "h-11 px-3 text-foreground underline decoration-border decoration-1 underline-offset-[6px] hover:decoration-accent hover:text-accent",
        className,
      )}
    >
      {children}
    </Link>
  );
}
