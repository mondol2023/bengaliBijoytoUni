import Link from "next/link";
import { UserMenu } from "@/components/auth/UserMenu";

/**
 * App chrome, shared by the landing page and the tool pages. Deliberately
 * minimal: the landing page carries the argument, so the header only has to
 * get people between the surfaces. Its rail matches `.plate` and `SiteFooter`
 * (76rem, 1.25/2rem gutters) so the wordmark sits on the same left edge as
 * every plate rule below it.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <div className="mx-auto flex h-14 w-full max-w-[76rem] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-md bg-accent font-bengali text-sm font-bold text-accent-foreground"
          >
            অ
          </span>
          <span className="max-sm:sr-only">Convert2Uni</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label="Primary" className="flex items-center text-sm sm:gap-1">
            <Link
              href="/converter"
              className="rounded-md px-2 py-2 font-medium sm:px-3 text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Converter
            </Link>
            <Link
              href="/documents"
              className="rounded-md px-2 py-2 font-medium sm:px-3 text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Documents
            </Link>
            <Link
              href="/ocr"
              className="rounded-md px-2 py-2 font-medium sm:px-3 text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              OCR
            </Link>
            <Link
              href="/compare"
              className="rounded-md px-2 py-2 font-medium sm:px-3 text-foreground/80 transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Compare
            </Link>
          </nav>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
