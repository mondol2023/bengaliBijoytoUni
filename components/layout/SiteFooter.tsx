import Link from "next/link";
import { FOOTER_LINK_LABEL, PRIVACY_HREF } from "@/lib/privacy/disclosure";

/**
 * A colophon rather than a sitemap. The app has four pages worth linking and
 * two facts worth restating — an inflated footer would be furniture for a
 * product that does not exist yet.
 *
 * Privacy is the one entry that is not a feature. It is here because both
 * inline disclosure lines end in a link to the same page, and a reader who
 * has left the converter should still be able to find it.
 */
const LINKS = [
  { href: "/converter", label: "Converter" },
  { href: "/documents", label: "Documents" },
  { href: "/compare", label: "Compare" },
  { href: PRIVACY_HREF, label: FOOTER_LINK_LABEL.en },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-[76rem] px-5 py-10 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-6">
          <div>
            <p className="flex items-center gap-2 font-semibold tracking-tight">
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-md bg-accent font-bengali text-xs font-bold text-accent-foreground"
              >
                অ
              </span>
              Convert2Uni
            </p>
            <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-foreground/70">
              Legacy Bengali encodings re-set as standard Unicode, with the sequences it could not
              map reported rather than hidden.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-foreground/80 underline decoration-border decoration-1 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <p className="plate-marker mt-10 border-t border-border pt-5">
          Bijoy Classic · SutonnyMJ · mappings still converging
        </p>
      </div>
    </footer>
  );
}
