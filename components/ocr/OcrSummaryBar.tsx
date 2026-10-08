"use client";

import { CopyButton } from "@/components/converter/CopyButton";
import { MicroButton } from "@/components/ui/MicroButton";
import type { OcrJobState } from "@/features/ocr/job/jobState";
import { combineText, ocrDownloadName } from "@/features/ocr/job/view";
import { downloadTextFile } from "@/lib/utils/download";

/**
 * The finished sheet's controls. The one filled button on the page once there is something to take.
 * Renders nothing until at least one line has been read.
 */
export function OcrSummaryBar({
  state,
  fileName,
  onReadAgain,
}: {
  state: OcrJobState;
  fileName: string;
  onReadAgain: () => void;
}) {
  if (state.phase !== "done" && state.phase !== "cancelled") return null;
  const text = combineText(state.items, state.outcomes);
  if (text === "") return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4">
      <MicroButton onClick={onReadAgain}>Read again</MicroButton>
      <MicroButton onClick={() => downloadTextFile(ocrDownloadName(fileName), text)}>Download .txt</MicroButton>
      <CopyButton text={text} variant="primary" label="Copy all" />
    </div>
  );
}
