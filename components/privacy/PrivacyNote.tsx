import Link from "next/link";
import { PRIVACY_HREF, PRIVACY_LINK_LABEL, type Bilingual } from "@/lib/privacy/disclosure";
import { cn } from "@/lib/utils/cn";

/**
 * One inline disclosure line, in English and Bengali, ending in a link to
 * `/privacy`.
 *
 * Both languages are shown rather than switched between. There is no locale
 * mechanism in this app, and the audience for a legacy-Bengali converter is
 * not reliably reached by either language alone — so a reader gets whichever
 * one they read, and neither is hidden behind a control they have to find.
 *
 * The Bengali carries `lang="bn"` and `font-bengali` for the reason stated
 * in CLAUDE.md: `lang` so a screen reader switches voice, the font because
 * this is real Unicode Bengali rather than legacy bytes. The English is a
 * sibling element, not a wrapper, so the Bengali voice does not read it.
 *
 * Not dismissible and not a modal. A modal makes a routine, narrow
 * disclosure look like a consent event; a dismissible banner is invisible to
 * everyone who dismissed it once.
 */
export function PrivacyNote({ note, className }: { note: Bilingual; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 text-xs leading-relaxed text-foreground/60", className)}>
      <p>
        {note.en}{" "}
        <Link
          href={PRIVACY_HREF}
          className="underline decoration-border decoration-1 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent"
        >
          {PRIVACY_LINK_LABEL.en}
        </Link>
      </p>
      <p lang="bn" className="font-bengali">
        {note.bn}{" "}
        <Link
          href={PRIVACY_HREF}
          className="underline decoration-border decoration-1 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent"
        >
          {PRIVACY_LINK_LABEL.bn}
        </Link>
      </p>
    </div>
  );
}
