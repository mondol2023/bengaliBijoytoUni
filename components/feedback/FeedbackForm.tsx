"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, MessageSquarePlus, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { FEEDBACK_LIMITS } from "@/lib/feedback/limits";
import { motionTokens, springs } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

/**
 * The review/complaint form under each workspace. Anonymous submissions are
 * allowed — the people best placed to report a wrong conversion are often
 * first-time visitors who never sign in — so the email field appears only
 * when signed out; for a signed-in user the server takes the address from the
 * verified token instead of trusting this form.
 *
 * `sampleInput`/`sampleOutput` are passed in by the workspace so a "this
 * letter came out wrong" report arrives with the text that produced it,
 * without the user having to paste anything back. It is opt-out rather than
 * automatic, since that text is the user's own document.
 */

const CATEGORY_OPTIONS = [
  { value: "wrong_conversion", label: "Wrong conversion" },
  { value: "missing_character", label: "Missing / unmapped character" },
  { value: "file_problem", label: "Problem with a file" },
  { value: "bug", label: "Something is broken" },
  { value: "feature_request", label: "Feature request" },
  { value: "praise", label: "Praise" },
  { value: "other", label: "Other" },
];

const RATINGS = [1, 2, 3, 4, 5];

const UNREACHABLE: SafeErrorResponse = {
  code: "UNKNOWN_ERROR",
  message: "Could not reach the server — check your connection and try again.",
};

type Status = "idle" | "submitting" | "sent";

export interface FeedbackFormProps {
  /** Attached to the report so a complaint carries the conversion it is about. */
  encodingId?: string | null;
  sampleInput?: string | null;
  sampleOutput?: string | null;
  /** Pre-fill, for the "this is wrong" control on a marked segment. Editable like anything typed. */
  initialCategory?: string;
  initialMessage?: string;
  className?: string;
}

export function FeedbackForm({
  encodingId,
  sampleInput,
  sampleOutput,
  initialCategory,
  initialMessage,
  className,
}: FeedbackFormProps) {
  const { user, getIdToken } = useAuth();
  const pathname = usePathname();
  const reducedMotion = usePrefersReducedMotion();

  const messageId = useId();
  const emailId = useId();
  const contextId = useId();

  const [category, setCategory] = useState(initialCategory ?? "wrong_conversion");
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState(initialMessage ?? "");
  const [email, setEmail] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<SafeErrorResponse | null>(null);

  const hasContext = Boolean(sampleInput || sampleOutput);
  const trimmed = message.trim();
  const isSubmittable = trimmed.length > 0 && status !== "submitting";

  function truncate(value: string | null | undefined): string | null {
    if (!value) return null;
    return value.slice(0, FEEDBACK_LIMITS.maxSampleLength);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!isSubmittable) return;

    setStatus("submitting");
    setError(null);

    try {
      const idToken = user ? await getIdToken() : null;
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          category,
          rating,
          message: trimmed,
          email: user ? null : email.trim() || null,
          page: pathname ?? null,
          encodingId: encodingId ?? null,
          sampleInput: includeContext ? truncate(sampleInput) : null,
          sampleOutput: includeContext ? truncate(sampleOutput) : null,
        }),
      });
      const payload = (await response.json()) as
        | { ok: true; id: string }
        | { ok: false; error: SafeErrorResponse };

      if (!payload.ok) {
        setError(payload.error);
        setStatus("idle");
        return;
      }

      setStatus("sent");
      setMessage(initialMessage ?? "");
      setRating(null);
    } catch {
      setError(UNREACHABLE);
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <motion.section
        initial={reducedMotion ? false : { opacity: 0, y: motionTokens.distance.sm }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
        className={cn(
          "flex flex-col items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4",
          className,
        )}
      >
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <p className="text-sm font-semibold">Thanks — your feedback was sent.</p>
        </div>
        <p className="text-sm text-foreground/70">
          Every report is read. If you run into another problem, you can send a second one.
        </p>
        <Button variant="secondary" size="sm" onClick={() => setStatus("idle")}>
          Send another
        </Button>
      </motion.section>
    );
  }

  return (
    <section
      aria-labelledby="feedback-heading"
      className={cn("flex flex-col rounded-lg border border-border bg-surface", className)}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageSquarePlus className="h-4 w-4 shrink-0 text-foreground/60" aria-hidden />
        <h2 id="feedback-heading" className="text-sm font-semibold">
          Report a problem or leave a review
        </h2>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4 p-4">
        <p className="text-sm text-foreground/70">
          Found a letter that converted incorrectly, a file that would not open, or anything else worth
          telling us? Describe it below — it reaches the people maintaining the mapping rules.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">What is this about?</span>
            <Select
              value={category}
              onValueChange={setCategory}
              options={CATEGORY_OPTIONS}
              ariaLabel="Feedback category"
              className="w-full sm:w-64"
            />
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Rating (optional)</legend>
            <div className="flex items-center gap-1">
              {RATINGS.map((value) => {
                const isFilled = rating !== null && value <= rating;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value} out of 5`}
                    aria-pressed={rating === value}
                    onClick={() => setRating(rating === value ? null : value)}
                    className="rounded p-0.5 text-foreground/40 transition-colors hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Star className={cn("h-5 w-5", isFilled && "fill-warning text-warning")} aria-hidden />
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <label htmlFor={messageId} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">What happened?</span>
          <textarea
            id={messageId}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={FEEDBACK_LIMITS.maxMessageLength}
            rows={4}
            required
            placeholder="e.g. the conjunct in my second paragraph came out as three separate letters…"
            className="resize-y rounded-md border border-border bg-background p-3 text-sm outline-none placeholder:text-foreground/40 focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="text-xs text-foreground/50">
            {trimmed.length.toLocaleString()} / {FEEDBACK_LIMITS.maxMessageLength.toLocaleString()}
          </span>
        </label>

        {!user && (
          <label htmlFor={emailId} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Email{" "}
              <span className="font-normal text-foreground/50">(optional — only if you want a reply)</span>
            </span>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-foreground/40 focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
        )}

        {hasContext && (
          <label htmlFor={contextId} className="flex items-start gap-2">
            <input
              id={contextId}
              type="checkbox"
              checked={includeContext}
              onChange={(event) => setIncludeContext(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span className="text-sm text-foreground/70">
              Include the text I was converting{encodingId ? ` (${encodingId})` : ""} so the problem can be
              reproduced.
            </span>
          </label>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              key="feedback-error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { duration: motionTokens.duration.fast, ease: motionTokens.easing.standard }
              }
              className="overflow-hidden"
            >
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!isSubmittable} loading={status === "submitting"}>
            Send feedback
          </Button>
          {!user && (
            <span className="text-xs text-foreground/50">Sending anonymously — no account needed.</span>
          )}
        </div>
      </form>
    </section>
  );
}
