"use client";

import { Info } from "lucide-react";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
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
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="encoding-select" className="text-sm font-medium text-foreground/70">
        Source encoding
      </label>
      <Select
        value={choice}
        onValueChange={onChange}
        options={options}
        ariaLabel="Source encoding"
        className="min-w-40"
      />

      {choice === AUTO_DETECT &&
        (resolvedEncoding ? (
          <Badge tone="accent">
            Detected {resolvedEncoding.name} ({Math.round(detectionConfidence * 100)}%)
          </Badge>
        ) : (
          <Badge tone="neutral">No confident match yet</Badge>
        ))}

      {resolvedEncoding?.maturity === "experimental" && (
        <Tooltip content="This encoding's glyph mapping table is provisional starter data, not yet validated against real documents. Conversion accuracy may vary — please double-check important output.">
          <span className="inline-flex cursor-help">
            <Badge tone="warning">
              <Info className="h-3 w-3" aria-hidden />
              Experimental mapping
            </Badge>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
