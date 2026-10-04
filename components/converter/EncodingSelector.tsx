"use client";

import { Info } from "lucide-react";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
import type { EncodingDefinition } from "@/features/converter/encodings/types";
import { AUTO_DETECT, type EncodingChoice } from "@/hooks/useConversion";

export function EncodingSelector({
  encodings,
  choice,
  onChange,
  resolvedEncodingId,
  detectionConfidence,
}: {
  encodings: EncodingDefinition[];
  choice: EncodingChoice;
  onChange: (choice: EncodingChoice) => void;
  resolvedEncodingId: string | undefined;
  detectionConfidence: number;
}) {
  const options: SelectOption[] = [
    { value: AUTO_DETECT, label: "Auto-detect" },
    ...encodings.map((encoding) => ({ value: encoding.id, label: encoding.name })),
  ];

  const resolvedEncoding = encodings.find((encoding) => encoding.id === resolvedEncodingId);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="plate-marker">
        Encoding
      </span>
      <Select
        value={choice}
        onValueChange={onChange}
        options={options}
        ariaLabel="Source encoding"
        className="min-w-40"
      />

      {/* Detection is live engine state, so it reads in the mono readout
          style — terracotta once something is detected, muted while waiting.
          Nothing is shown before there is input to detect from. */}
      {choice === AUTO_DETECT && resolvedEncoding && (
        <span className="font-mono text-xs tabular-nums text-accent">
          {resolvedEncoding.name} · {Math.round(detectionConfidence * 100)}%
        </span>
      )}

      {resolvedEncoding?.maturity === "experimental" && (
        <Tooltip content="This encoding's glyph mapping table is provisional starter data, not yet validated against real documents. Conversion accuracy may vary — please double-check important output.">
          <span className="inline-flex cursor-help items-center gap-1 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-warning">
            <Info className="h-3 w-3" aria-hidden />
            Experimental mapping
          </span>
        </Tooltip>
      )}
    </div>
  );
}
