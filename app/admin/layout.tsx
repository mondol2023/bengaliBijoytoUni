import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSessionUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";

export const metadata: Metadata = {
  title: "Admin — Convert2Uni",
  robots: { index: false, follow: false },
};

const NAV_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/config", label: "Config" },
  { href: "/admin/errors", label: "Error log" },
  { href: "/admin/conversion-failures", label: "Conversion failures" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/audit", label: "Audit log" },
];

/**
 * Real server-side gate — verifies the admin custom claim via the httpOnly
 * session cookie (see `lib/auth/session.ts#getServerSessionUser`) before
 * rendering anything under `/admin`, so a non-admin never even receives the
 * page markup. This is defense in depth, not the sole boundary: every actual
 * mutation still goes through a `/api/admin/*` route that independently
 * verifies a fresh bearer token (`requireAdminUser`), and Firestore rules
 * independently gate direct reads — a bypass here would still hit both of
 * those.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isFirebaseAdminConfigured) redirect("/");

  const sessionUser = await getServerSessionUser();
  if (!sessionUser || sessionUser.role !== "admin") redirect("/");

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 outline-none sm:px-6 sm:py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Admin</h1>
        <p className="text-sm text-foreground/60">Signed in as {sessionUser.email ?? sessionUser.uid}</p>
      </div>
      <nav aria-label="Admin" className="flex w-fit items-center gap-1 rounded-md border border-border bg-surface-muted p-1 text-sm">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-sm px-3 py-1.5 font-medium text-foreground/70 transition-colors hover:bg-surface hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
