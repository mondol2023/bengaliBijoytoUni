import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_SIZE_BYTES, resolveFileFormat } from "../config";
import { extractDocumentText } from "../extract";
import { extractTxtText } from "../extract/txt";

describe("resolveFileFormat", () => {
  it("resolves by extension, case-insensitively", () => {
    expect(resolveFileFormat("Report.PDF", "")).toBe("pdf");
    expect(resolveFileFormat("legacy.doc", "")).toBe("doc");
    expect(resolveFileFormat("modern.docx", "")).toBe("docx");
    expect(resolveFileFormat("notes.txt", "")).toBe("txt");
  });

  it("falls back to MIME type when the extension is missing or unrecognized", () => {
    expect(resolveFileFormat("noext", "application/pdf")).toBe("pdf");
    expect(resolveFileFormat("noext", "text/plain")).toBe("txt");
  });

  it("returns undefined for unsupported files", () => {
    expect(resolveFileFormat("image.png", "image/png")).toBeUndefined();
  });
});

describe("extractTxtText", () => {
  it("extracts plain text and strips a leading BOM", () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Avwg fvbyv", "utf-8")]);
    const result = extractTxtText(buffer, "sample.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toBe("Avwg fvbyv");
  });

  it("rejects an empty file", () => {
    const result = extractTxtText(Buffer.from(""), "empty.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toMatchObject({ reason: "empty" });
  });
});

describe("extractDocumentText dispatcher", () => {
  it("rejects an empty buffer before touching a format-specific extractor", async () => {
    const result = await extractDocumentText(Buffer.from(""), "empty.pdf", "application/pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toMatchObject({ reason: "empty" });
  });

  it("rejects files over the size limit", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_SIZE_BYTES + 1, 65);
    const result = await extractDocumentText(oversized, "big.txt", "text/plain");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toMatchObject({ reason: "too_large" });
  });

  it("rejects unsupported file types", async () => {
    const result = await extractDocumentText(Buffer.from("data"), "image.png", "image/png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toMatchObject({ reason: "unsupported_format" });
  });

  it("dispatches .txt files through the real text extractor", async () => {
    const result = await extractDocumentText(Buffer.from("Kvgvj Avjx"), "note.txt", "text/plain");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toBe("Kvgvj Avjx");
  });

  it("returns a typed error instead of throwing on a corrupted .pdf", async () => {
    const result = await extractDocumentText(Buffer.from("not a real pdf"), "broken.pdf", "application/pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
  });

  it("returns a typed error instead of throwing on a corrupted .docx", async () => {
    const result = await extractDocumentText(
      Buffer.from("not a real docx"),
      "broken.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
  });

  it("returns a typed error instead of throwing on a corrupted .doc", async () => {
    const result = await extractDocumentText(Buffer.from("not a real doc"), "broken.doc", "application/msword");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
  });
});
