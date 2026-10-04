import { cn } from "@/lib/utils/cn";

/**
 * The running head of a tool page — the same furniture as the landing page's
 * `PlateHead`, promoted to the page's single `h1`. The marker at the right of
 * the rule is live status computed by the page (detected encoding, accepted
 * formats, similarity), never a label restating the heading.
 */
export function ToolHead({
  title,
  marker,
  standfirst,
  className,
}: {
  title: string;
  marker: React.ReactNode;
  standfirst?: string;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
        <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl">
          {title}
        </h1>
        <span className="plate-marker shrink-0 pb-1" aria-live="polite">
          {marker}
        </span>
      </div>
      {standfirst ? (
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-foreground/70 sm:text-base">
          {standfirst}
        </p>
      ) : null}
    </div>
  );
}
