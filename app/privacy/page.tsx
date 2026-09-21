import type { Metadata } from "next";
import {
  PRIVACY_PAGE_INTRO,
  PRIVACY_PAGE_SECTIONS,
  PRIVACY_PAGE_TITLE,
} from "@/lib/privacy/disclosure";

export const metadata: Metadata = {
  title: "What we collect — Convert2Uni",
  description:
    "What Convert2Uni collects when a legacy Bengali sequence cannot be converted, what it never collects, and how long any of it is kept.",
};

/**
 * The page both inline disclosure lines link to. A static server component:
 * every string comes from `lib/privacy/disclosure.ts`, nothing here is
 * interactive, and there is no reason for any of it to reach the client as
 * JavaScript.
 *
 * English and Bengali are shown side by side per section rather than as two
 * separate pages, for the same reason `PrivacyNote` shows both — see its doc
 * comment. Each Bengali block is its own `lang="bn"` element so a screen
 * reader switches voice for it and not for the English beside it.
 */
export default function PrivacyPage() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12 outline-none sm:px-6"
    >
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{PRIVACY_PAGE_TITLE.en}</h1>
        <h2 lang="bn" className="font-bengali text-xl font-semibold tracking-tight text-foreground/80">
          {PRIVACY_PAGE_TITLE.bn}
        </h2>
        <p className="max-w-[60ch] text-sm leading-relaxed text-foreground/70">
          {PRIVACY_PAGE_INTRO.en}
        </p>
        <p lang="bn" className="font-bengali max-w-[60ch] text-sm leading-relaxed text-foreground/70">
          {PRIVACY_PAGE_INTRO.bn}
        </p>
      </header>

      {PRIVACY_PAGE_SECTIONS.map((section) => (
        <section key={section.heading.en} className="flex flex-col gap-4">
          <div className="border-b border-border pb-2">
            <h2 className="text-base font-semibold tracking-tight">{section.heading.en}</h2>
            <h3 lang="bn" className="font-bengali text-base font-semibold tracking-tight text-foreground/70">
              {section.heading.bn}
            </h3>
          </div>
          {section.body.map((paragraph) => (
            <div key={paragraph.en} className="flex flex-col gap-1.5">
              <p className="max-w-[68ch] text-sm leading-relaxed">{paragraph.en}</p>
              <p lang="bn" className="font-bengali max-w-[68ch] text-sm leading-relaxed text-foreground/75">
                {paragraph.bn}
              </p>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
