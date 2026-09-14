"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, Shield, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "./AuthProvider";
import { SignInDialog } from "./SignInDialog";

/**
 * Header auth widget. Deliberately no dropdown (no Radix dropdown-menu
 * dependency in this project) — signed-in state is just a link to the
 * account page plus an inline sign-out action, matching `SiteHeader`'s
 * "minimal app chrome" scope.
 */
export function UserMenu() {
  const { isConfigured, isLoading, user, profile, signOutUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!isConfigured || isLoading) return null;

  if (!user) {
    return (
      <>
        <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
          Sign in
        </Button>
        <SignInDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {profile?.role === "admin" && (
        <Link
          href="/admin"
          className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <Shield className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Admin</span>
        </Link>
      )}
      <Link
        href="/account"
        className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        <UserIcon className="h-4 w-4" aria-hidden />
        <span className="max-w-[10rem] truncate">{user.email}</span>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void signOutUser()}
        leftIcon={<LogOut className="h-4 w-4" aria-hidden />}
        aria-label="Sign out"
      >
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </Button>
    </div>
  );
}
