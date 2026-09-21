/**
 * The file-name bound, and the regression it exists to prevent: an uploaded
 * document's name must not reach any stored diagnostic row. Both writers
 * (`conversionFailures` via the shared occurrence builder, `errorLogs` via
 * `writeErrorLog`) reduce through this one function, so these cases are the
 * whole of the rule.
 */
import { describe, expect, it } from "vitest";
import { fileExtensionOnly } from "../fileName";
import { ACCEPTED_FILE_EXTENSIONS } from "@/features/documents/config";

describe("fileExtensionOnly", () => {
  it("keeps the extension and drops the name", () => {
    expect(fileExtensionOnly("q3-layoffs-draft.docx")).toBe(".docx");
    expect(fileExtensionOnly("annual report 2026.pdf")).toBe(".pdf");
  });

  it("lowercases, so .PDF and .pdf are one value", () => {
    expect(fileExtensionOnly("SCAN.PDF")).toBe(".pdf");
  });

  it("returns every format the uploader accepts", () => {
    for (const extension of ACCEPTED_FILE_EXTENSIONS) {
      expect(fileExtensionOnly(`name${extension}`)).toBe(extension);
    }
  });

  it("takes only the final segment of a multi-dot name", () => {
    expect(fileExtensionOnly("patient.records.2026.txt")).toBe(".txt");
  });

  it("returns null when there is nothing that is an extension", () => {
    expect(fileExtensionOnly("README")).toBeNull();
    expect(fileExtensionOnly("trailing.")).toBeNull();
    expect(fileExtensionOnly(".gitignore")).toBeNull();
    expect(fileExtensionOnly("")).toBeNull();
    expect(fileExtensionOnly(null)).toBeNull();
    expect(fileExtensionOnly(undefined)).toBeNull();
  });

  it("strips a path, so a directory name cannot ride along", () => {
    expect(fileExtensionOnly("C:\Users\Someone\medical\scan.pdf")).toBe(".pdf");
    expect(fileExtensionOnly("/home/someone/medical/scan.pdf")).toBe(".pdf");
  });

  it("rejects an extension carrying anything a real one does not", () => {
    // The shapes a caller would reach for to smuggle the name back through.
    expect(fileExtensionOnly("x.docx?name=q3-layoffs")).toBeNull();
    expect(fileExtensionOnly("x.doc x")).toBeNull();
    expect(fileExtensionOnly("x.c-v")).toBeNull();
    expect(fileExtensionOnly(`x.${"a".repeat(17)}`)).toBeNull();
  });

  it("never returns a value longer than an extension", () => {
    const names = ["q3-layoffs-draft.docx", "a".repeat(200) + ".pdf", "no-extension-at-all"];
    for (const name of names) {
      const stored = fileExtensionOnly(name);
      expect(stored === null || stored.length <= 17).toBe(true);
      if (stored !== null) expect(name.toLowerCase().endsWith(stored)).toBe(true);
    }
  });
});
