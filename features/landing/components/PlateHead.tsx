import { cn } from "@/lib/utils/cn";

/**
 * The running head at the top of every plate: heading at the left of the
 * rule, plate marker at the right of the same rule. The marker is folio
 * furniture — it sits beside the heading, never stacked above it as a label
 * restating what the heading already says.
 */
export function PlateHead({
  heading,
  marker,
  standfirst,
  className,
  headingId,
}: {
  heading: string;
  marker: string;
  standfirst?: string;
  className?: string;
  headingId?: string;
}) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
        <h2
          id={headingId}
          className="max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {heading}
        </h2>
        <span className="plate-marker shrink-0 pb-1">{marker}</span>
      </div>
      {standfirst ? (
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-foreground/70">{standfirst}</p>
      ) : null}
    </div>
  );
}
