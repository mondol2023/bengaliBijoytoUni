"use client";

import { useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { FileText, FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ACCEPTED_FILE_EXTENSIONS, MAX_UPLOAD_SIZE_BYTES } from "@/features/documents/config";
import { springs } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024));

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentDropzone({
  file,
  onFileSelected,
  disabled,
}: {
  file: File | null;
  onFileSelected: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
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
      className="flex flex-col"
    >
      <label
        htmlFor={inputId}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          isDragging ? "border-accent bg-accent-muted" : "border-border bg-surface-muted",
        )}
      >
        <motion.div
          animate={isDragging ? { scale: 1.05 } : { scale: 1 }}
          transition={springs.snappy}
          className="flex flex-col items-center gap-2"
        >
          <FileUp className="h-8 w-8 text-accent" aria-hidden />
          <p className="text-sm font-medium">
            Drop a file here, or <span className="text-accent underline">browse</span>
          </p>
          <p className="text-xs text-foreground/60">
            {ACCEPTED_FILE_EXTENSIONS.join(", ")} · up to {MAX_UPLOAD_MB}MB
          </p>
        </motion.div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPTED_FILE_EXTENSIONS.join(",")}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </label>

      {file && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-foreground/60" aria-hidden />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-foreground/50">{formatBytes(file.size)}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onFileSelected(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            aria-label="Remove file"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
