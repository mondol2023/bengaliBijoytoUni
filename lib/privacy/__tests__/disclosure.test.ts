/**
 * A disclosure that has drifted from the code is worse than no disclosure:
 * it is a false statement rather than a missing one, and nothing about
 * changing `CONTEXT_WINDOW_CHARS` or a retention constant would otherwise
 * make anyone open the copy. These tests fail that change instead.
 *
 * They check the numbers against their sources and the shape of the copy.
 * They cannot check that the sentences are true — that is what the
 * file-and-line comment above each block in `disclosure.ts` is for.
 */
import { describe, expect, it } from "vitest";
import {
  CONTEXT_WINDOW_DISCLOSED,
  CONVERTER_NOTE,
  DOCUMENTS_NOTE,
  FOOTER_LINK_LABEL,
  PRIVACY_LINK_LABEL,
  PRIVACY_PAGE_INTRO,
  PRIVACY_PAGE_SECTIONS,
  PRIVACY_PAGE_TITLE,
  RETENTION,
  type Bilingual,
} from "../disclosure";
import { CONTEXT_WINDOW_CHARS } from "@/lib/conversionFailures/occurrence";
import { RETENTION_DAYS } from "@/lib/conversionFailures/retention";

/** Every `Bilingual` in the file, flattened, so no block escapes the shape checks. */
const allCopy: { label: string; value: Bilingual }[] = [
  { label: "CONVERTER_NOTE", value: CONVERTER_NOTE },
  { label: "DOCUMENTS_NOTE", value: DOCUMENTS_NOTE },
  { label: "PRIVACY_LINK_LABEL", value: PRIVACY_LINK_LABEL },
  { label: "FOOTER_LINK_LABEL", value: FOOTER_LINK_LABEL },
  { label: "PRIVACY_PAGE_TITLE", value: PRIVACY_PAGE_TITLE },
  { label: "PRIVACY_PAGE_INTRO", value: PRIVACY_PAGE_INTRO },
  ...PRIVACY_PAGE_SECTIONS.flatMap((section, i) => [
    { label: `section[${i}].heading`, value: section.heading },
    ...section.body.map((paragraph, j) => ({ label: `section[${i}].body[${j}]`, value: paragraph })),
  ]),
];

/** Bengali block, U+0980–U+09FF. */
const BENGALI = /[ঀ-৿]/;

describe("the disclosure copy agrees with the code it describes", () => {
  it("states the context window the reporters actually send", () => {
    expect(CONTEXT_WINDOW_DISCLOSED).toBe(CONTEXT_WINDOW_CHARS);
  });

  it("states the retention periods the writer actually stamps", () => {
    expect(RETENTION.occurrenceDays).toBe(RETENTION_DAYS.conversionFailures);
    expect(RETENTION.patternDays).toBe(RETENTION_DAYS.failurePatterns);
  });

  it("quotes the window number in both languages of the converter line", () => {
    // Prevents the number being changed in the constant and left stale in
    // one translation, which no type would catch.
    expect(CONVERTER_NOTE.en).toContain(String(CONTEXT_WINDOW_DISCLOSED));
    expect(CONVERTER_NOTE.bn).toContain(String(CONTEXT_WINDOW_DISCLOSED));
  });

  it("quotes both retention periods on the page", () => {
    const page = PRIVACY_PAGE_SECTIONS.flatMap((s) => s.body)
      .map((b) => `${b.en} ${b.bn}`)
      .join(" ");
    expect(page).toContain(String(RETENTION.occurrenceDays));
    expect(page).toContain(String(RETENTION.patternDays));
  });
});

describe("the disclosure copy is complete in both languages", () => {
  it("has a non-empty English and Bengali form of every block", () => {
    for (const { label, value } of allCopy) {
      expect(value.en.trim().length, `${label}.en`).toBeGreaterThan(0);
      expect(value.bn.trim().length, `${label}.bn`).toBeGreaterThan(0);
    }
  });

  it("has actual Bengali in every Bengali block", () => {
    // Catches the copy-paste that leaves an English string in the `bn` slot.
    for (const { label, value } of allCopy) {
      expect(BENGALI.test(value.bn), `${label}.bn has no Bengali characters`).toBe(true);
      expect(BENGALI.test(value.en), `${label}.en has Bengali characters`).toBe(false);
    }
  });

  it("gives the document upload its own line rather than reusing the converter's", () => {
    // The converter says text is not uploaded. On the documents page that is
    // false, which is the whole reason for a second line.
    expect(DOCUMENTS_NOTE.en).not.toBe(CONVERTER_NOTE.en);
    expect(CONVERTER_NOTE.en).toContain("not uploaded");
    expect(DOCUMENTS_NOTE.en).toContain("our server");
  });

  it("promises deletion only in the form the code can keep", () => {
    // `DELETE /api/documents/[documentId]` exists, so the strong wording is
    // allowed. If that route is ever removed this has to go back to "you can
    // ask us to delete it" — this assertion is where that gets noticed.
    expect(DOCUMENTS_NOTE.en).toContain("you can delete it at any time");
  });

  it("keeps the page to sections a reader will finish", () => {
    expect(PRIVACY_PAGE_SECTIONS.length).toBeGreaterThan(0);
    for (const section of PRIVACY_PAGE_SECTIONS) {
      expect(section.body.length).toBeGreaterThan(0);
    }
  });
});
