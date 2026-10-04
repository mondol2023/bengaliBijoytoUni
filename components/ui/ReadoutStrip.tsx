import { cn } from "@/lib/utils/cn";

export type ReadoutTone = "ok" | "warning" | "danger";

export interface Readout {
  label: string;
  value: string;
  tone?: ReadoutTone;
}

const TONE_CLASSES: Record<ReadoutTone, string> = {
  ok: "text-foreground",
  warning: "text-warning",
  danger: "text-danger",
};

/**
 * The ruled read-out row under a sheet: mono terms, tabular mono values.
 * Every value passed in must be one the engine computed (the Measured-Figure
 * Rule) — this is an instrument panel, not a place for copy.
 */
export function ReadoutStrip({
  readouts,
  className,
  size = "sm",
}: {
  readouts: Readout[];
  className?: string;
  size?: "sm" | "lg";
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3",
        readouts.length > 4 ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-4",
        className,
      )}
    >
      {readouts.map(({ label, value, tone = "ok" }) => (
        <div key={label} className="min-w-0">
          <dt className="plate-marker">{label}</dt>
          <dd
            className={cn(
              "mt-0.5 truncate font-mono tabular-nums",
              size === "lg" ? "text-xl" : "text-sm",
              TONE_CLASSES[tone],
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
