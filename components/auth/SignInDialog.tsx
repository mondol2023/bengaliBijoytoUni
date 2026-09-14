"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useAuth } from "./AuthProvider";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Email/password + Google sign-in and sign-up, in one dialog with a mode toggle. */
export function SignInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<SafeErrorResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setEmail("");
    setPassword("");
    setError(null);
    setIsSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const result = mode === "signin" ? await signInWithEmail(email, password) : await signUpWithEmail(email, password);
    setIsSubmitting(false);
    if (result) {
      setError(result);
      return;
    }
    handleOpenChange(false);
  }

  async function handleGoogle() {
    setError(null);
    setIsSubmitting(true);
    const result = await signInWithGoogle();
    setIsSubmitting(false);
    if (result) {
      setError(result);
      return;
    }
    handleOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={mode === "signin" ? "Sign in" : "Create an account"}
      description="Save your conversion and comparison history, and unlock your account's usage tier."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="signin-email" className="text-sm font-medium text-foreground/70">
            Email
          </label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="signin-password" className="text-sm font-medium text-foreground/70">
            Password
          </label>
          <input
            id="signin-password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error.message}</span>
          </div>
        )}

        <Button type="submit" loading={isSubmitting} className="mt-1 w-full justify-center">
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-foreground/40">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="secondary"
        onClick={handleGoogle}
        disabled={isSubmitting}
        className="w-full justify-center"
      >
        Continue with Google
      </Button>

      <p className="mt-4 text-center text-sm text-foreground/60">
        {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </Dialog>
  );
}
