"use client";

import { useId, useState } from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { OCR_MAX_FILE_BYTES } from "@/features/ocr/config";
import { motionTokens, springs } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";

const MAX_MB = Math.round(OCR_MAX_FILE_BYTES / (1024 * 1024));

/** A small sheet of ruled lines with a scan line riding down it. Decorative. */
function PageGlyph({ animate }: { animate: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative flex h-[84px] w-16 flex-col gap-[5px] overflow-hidden border border-border bg-white px-2 py-3"
    >
      {["70%", "90%", "60%", "85%", "50%"].map((width) => (
        <span key={width} className="h-1 bg-foreground/15" style={{ width }} />
      ))}
      {animate && (
        <motion.span
          className="absolute inset-x-0 h-0.5 bg-accent"
          initial={{ top: "8%", opacity: 0 }}
          animate={{ top: "92%", opacity: [0, 1, 1, 0] }}
          transition={{
            duration: motionTokens.duration.deliberate * 3,
            ease: motionTokens.easing.standard,
            repeat: Infinity,
          }}
        />
      )}
    </span>
  );
}

export function OcrDropzone({
  file,
  onFileSelected,
  disabled,
}: {
  file: File | null;
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(fileList: FileList | null) {
    const next = fileList?.[0];
    if (next) onFileSelected(next);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
    >
      <label
        htmlFor={inputId}
        className={cn(
          "flex flex-col items-center justify-center gap-2.5 border p-6 text-center transition-colors",
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
          file ? "min-h-28" : "min-h-60",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-surface",
          isDragging ? "border-accent bg-accent-muted" : "border-border bg-surface-muted",
        )}
      >
        <motion.div
          animate={isDragging && !reducedMotion ? { scale: motionTokens.scale.pop } : { scale: 1 }}
          transition={springs.snappy}
          className="flex flex-col items-center gap-2.5"
        >
          {!file && <PageGlyph animate={!reducedMotion} />}
          <p className="text-base font-medium">
            {file ? "Drop another file, or " : "Drop a PDF or Word file, or "}
            <span className="text-accent underline decoration-1 underline-offset-4">choose one</span>
          </p>
          <p className="plate-marker">pdf · docx · up to {MAX_MB} MB</p>
        </motion.div>
        <input
          id={inputId}
          type="file"
          accept=".pdf,.docx"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            handleFiles(event.target.files);
            // Choosing the same file twice must still count as a choice.
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
