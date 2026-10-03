"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CATEGORY_LABELS, formatDate } from "@/components/admin/AdminConversionFailures";
import { OccurrenceCountNote } from "@/components/admin/OccurrenceCountNote";
import { useConversionFailureDetail, type ReviewDecision } from "@/hooks/useConversionFailureDetail";
import { SUPPORTED_PROVIDER_IDS, type ProviderId } from "@/lib/ai/types";
import { RESOLUTION_LIMITS } from "@/lib/ai/limits";
import type { AiResolution, ConversionFailure } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

type WithId<T> = T & { id: string };
type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const PROVIDER_LABELS: Record<ProviderId, string> = { gemini: "Gemini", openai: "OpenAI" };

const CONFIDENCE_TONES: Record<AiResolution["confidence"], BadgeTone> = {
  high: "success",
  medium: "warning",
  low: "danger",
  unknown: "neutral",
};

const STATUS_LABELS: Record<AiResolution["status"], string> = {
  pending: "Pending",
  completed: "Awaiting review",
  failed: "Failed",
  reviewed: "Reviewed",
};

const STATUS_TONES: Record<AiResolution["status"], BadgeTone> = {
  pending: "neutral",
  completed: "warning",
  failed: "danger",
  reviewed: "success",
};

function BackLink() {
  return (
    <Link
      href="/admin/conversion-failures"
      className="inline-flex items-center gap-1.5 text-sm text-foreground/70 hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back to conversion failures
    </Link>
  );
}

/** One recorded occurrence — the original, unedited evidence. Context/full text stay collapsed by default. */
function OccurrenceRow({ occurrence }: { occurrence: WithId<ConversionFailure> }) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={occurrence.severity === "error" ? "danger" : "warning"}>{occurrence.severity}</Badge>
        <Badge tone="neutral">{occurrence.source}</Badge>
        {occurrence.fileName && <Badge tone="neutral">{occurrence.fileName}</Badge>}
        <span className="ml-auto text-xs text-foreground/40">{formatDate(occurrence.createdAt)}</span>
      </div>

      <p className="text-sm text-foreground/80">{occurrence.errorReason}</p>

      {occurrence.engineOutput !== null && (
        <div className="rounded-md border border-border bg-surface-muted p-2">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-foreground/50">Engine output (actual)</p>
          <pre lang="bn" className="font-bengali overflow-x-auto whitespace-pre-wrap break-words text-xs">
            {occurrence.engineOutput}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/50">
        <span className="font-mono">{occurrence.errorCode}</span>
        <span>
          {occurrence.userId
            ? `uid: ${occurrence.userId}`
            : // Rows from before visitor labels, and server-captured ones, have none.
              (occurrence.anonymousLabel ?? "anonymous")}
        </span>
        {occurrence.position !== null && <span>offset {occurrence.position}</span>}
        {occurrence.rulesHash && <span className="font-mono">rules {occurrence.rulesHash}</span>}
        {occurrence.route && <span className="font-mono">{occurrence.route}</span>}
      </div>

      <details className="rounded-md border border-border bg-surface-muted">
        <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-medium text-foreground/70">
          Context{occurrence.fullTextTruncated ? " (legacy full text truncated)" : ""}
        </summary>
        <div className="flex flex-col gap-2 border-t border-border p-2">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-foreground/50">Failed sequence in context</p>
            {/* Legacy source bytes, not Bengali: these context windows are
                slices of the original conversion *input*. Noto Sans Bengali
                has no glyphs for these Latin-1 code points, so it silently
                falls back to whatever the system picks — mono renders them
                predictably, which is the whole point of this panel. */}
            <pre className="font-mono overflow-x-auto whitespace-pre-wrap break-words text-xs">
              {occurrence.contextBefore}
              <mark className="rounded bg-warning/20 px-0.5">{occurrence.failedSequence}</mark>
              {occurrence.contextAfter}
            </pre>
          </div>
          {/* Only occurrences recorded before the privacy bound carry this;
              nothing collects the whole input any more, so new rows have an
              empty string here and render just the window above. */}
          {occurrence.fullText !== "" && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-foreground/50">
                Full original text (legacy record)
              </p>
              <pre className="font-mono max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                {occurrence.fullText}
              </pre>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

/** One AI resolution candidate. Its own accent-bordered block keeps AI output visually distinct from occurrence evidence above. */
function ResolutionCard({
  resolution,
  onReview,
}: {
  resolution: WithId<AiResolution>;
  onReview: (decision: ReviewDecision, note: string | null) => Promise<SafeErrorResponse | null>;
}) {
  const [note, setNote] = useState(resolution.reviewNote ?? "");
  const [submitting, setSubmitting] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isReviewable = resolution.status === "completed";
  const isTerminal = resolution.status === "reviewed";

  async function submit(decision: ReviewDecision) {
    setSubmitting(decision);
    setError(null);
    const failure = await onReview(decision, note.trim() || null);
    if (failure) setError(failure.message);
    setSubmitting(null);
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{PROVIDER_LABELS[resolution.provider]}</Badge>
        <Badge tone="neutral">{resolution.model}</Badge>
        <Badge tone={STATUS_TONES[resolution.status]}>{STATUS_LABELS[resolution.status]}</Badge>
        {resolution.status === "reviewed" && resolution.reviewDecision && (
          <Badge tone={resolution.reviewDecision === "accepted" ? "success" : "danger"}>
            {resolution.reviewDecision}
          </Badge>
        )}
        {resolution.confidence !== "unknown" && (
          <Badge tone={CONFIDENCE_TONES[resolution.confidence]}>confidence: {resolution.confidence}</Badge>
        )}
        <span className="ml-auto text-xs text-foreground/40">{formatDate(resolution.createdAt)}</span>
      </div>

      <div className="rounded-md border border-accent/30 bg-accent-muted/40 p-2">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-accent">AI candidate conversion (unverified)</p>
        {resolution.candidateConversion !== null ? (
          <pre lang="bn" className="font-bengali overflow-x-auto whitespace-pre-wrap break-words text-sm">
            {resolution.candidateConversion}
          </pre>
        ) : (
          <p className="text-sm italic text-foreground/50">No usable candidate produced.</p>
        )}
      </div>

      {resolution.alternativeCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-foreground/50">Alternatives:</span>
          {resolution.alternativeCandidates.map((alternative, index) => (
            <code
              key={index}
              lang="bn"
              className="font-bengali rounded border border-border bg-surface-muted px-1.5 py-0.5 text-xs"
            >
              {alternative}
            </code>
          ))}
        </div>
      )}

      {resolution.reasoningSummary && <p className="text-xs text-foreground/60">{resolution.reasoningSummary}</p>}

      {isReviewable && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <label className="flex-1">
            <span className="sr-only">Review note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={RESOLUTION_LIMITS.maxReviewNoteLength}
              rows={2}
              placeholder="Optional review note…"
              className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm outline-none placeholder:text-foreground/40 focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={submitting === "accepted"}
              disabled={submitting !== null}
              onClick={() => submit("accepted")}
            >
              Accept
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={submitting === "rejected"}
              disabled={submitting !== null}
              onClick={() => submit("rejected")}
            >
              Reject
            </Button>
          </div>
        </div>
      )}

      {isTerminal && (
        <p className="text-xs text-foreground/40">
          {resolution.reviewDecision === "accepted" ? "Accepted" : "Rejected"} by{" "}
          {resolution.reviewedBy ?? "unknown"}
          {resolution.reviewedAt ? ` on ${formatDate(resolution.reviewedAt)}` : ""}
          {resolution.reviewNote ? ` — "${resolution.reviewNote}"` : ""}
        </p>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </li>
  );
}

/**
 * One failure pattern's detail: metadata, its recorded occurrences (original
 * evidence, collapsed by default), and every AI resolution attempted against
 * it, with resolve/accept/reject actions. See
 * `docs/conversion-failure-pipeline.md` §7.2/§7.4 for the API contracts this
 * only ever calls — it never talks to a provider or Firestore directly.
 */
export function AdminConversionFailureDetail({ patternId }: { patternId: string }) {
  const { pattern, occurrences, resolutions, isLoading, error, notFound, resolve, review, refresh } =
    useConversionFailureDetail(patternId);
  const [resolvingProvider, setResolvingProvider] = useState<ProviderId | null>(null);
  const [resolveNotice, setResolveNotice] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function handleResolve(provider: ProviderId) {
    setResolvingProvider(provider);
    setResolveNotice(null);
    setResolveError(null);
    const { error: failure, reused } = await resolve(provider);
    if (failure) setResolveError(failure.message);
    else setResolveNotice(reused ? "Reused an existing matching resolution." : "Resolution complete.");
    setResolvingProvider(null);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p className="text-sm text-foreground/50">Loading…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-foreground/50">
          This failure pattern no longer exists.
        </p>
      </div>
    );
  }

  if (error || !pattern) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p className="text-sm text-danger">{error ?? "Could not load this failure pattern."}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink />
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}
        >
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={pattern.status === "open" ? "warning" : "success"}>
            {pattern.status === "open" ? "Open" : "Resolved"}
          </Badge>
          <Badge tone="neutral">{CATEGORY_LABELS[pattern.failureCategory]}</Badge>
          {pattern.encodingId && <Badge tone="neutral">{pattern.encodingId}</Badge>}
          <Badge tone="accent">×{pattern.occurrenceCount.toLocaleString()} occurrences</Badge>
        </div>
        {/* Shown here too, not only on the list: this is the page someone
            reads before deciding a pattern is worth an AI call, and that
            decision is made on this number. */}
        <OccurrenceCountNote />
        {/* The failed sequence is legacy source bytes — mono, like every other
            raw byte display in this panel. */}
        <p className="font-mono break-words text-lg text-foreground/90">{pattern.failedSequence}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/50">
          <span>engine {pattern.engineVersion}</span>
          <span>first seen {formatDate(pattern.firstSeenAt)}</span>
          <span>last seen {formatDate(pattern.lastSeenAt)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Resolve with AI</h3>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_PROVIDER_IDS.map((provider) => (
              <Button
                key={provider}
                variant="secondary"
                size="sm"
                leftIcon={<Sparkles className="h-4 w-4" aria-hidden />}
                loading={resolvingProvider === provider}
                disabled={resolvingProvider !== null}
                onClick={() => handleResolve(provider)}
              >
                Resolve with {PROVIDER_LABELS[provider]}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-foreground/50">
          A candidate is never applied automatically — it only becomes evidence for a real mapping-rule fix once
          an admin accepts it below.
        </p>
        {resolveNotice && <p className="text-xs text-success">{resolveNotice}</p>}
        {resolveError && <p className="text-xs text-danger">{resolveError}</p>}
      </div>

      <div className="flex flex-col rounded-lg border border-border bg-surface">
        <h3 className="px-4 pt-3 text-sm font-semibold">AI resolutions</h3>
        <ul className="flex flex-col divide-y divide-border">
          {resolutions.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-foreground/50">No AI resolution attempted yet.</li>
          )}
          {resolutions.map((resolution) => (
            <ResolutionCard
              key={resolution.id}
              resolution={resolution}
              onReview={(decision, note) => review(resolution.id, decision, note)}
            />
          ))}
        </ul>
      </div>

      <div className="flex flex-col rounded-lg border border-border bg-surface">
        <h3 className="px-4 pt-3 text-sm font-semibold">Original failure evidence ({occurrences.length})</h3>
        <ul className="flex flex-col divide-y divide-border">
          {occurrences.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-foreground/50">No occurrences recorded.</li>
          )}
          {occurrences.map((occurrence) => (
            <OccurrenceRow key={occurrence.id} occurrence={occurrence} />
          ))}
        </ul>
      </div>
    </div>
  );
}
