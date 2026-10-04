import mammoth from "mammoth";
import type { SourceRun } from "@/features/converter/engine/fontRuns";
import { AppErrors, err, ok, type Result } from "@/lib/errors/types";
import type { ExtractedDocument } from "./types";

/**
 * The slice of mammoth's document tree this extractor reads. mammoth types
 * `transformDocument` as `any`; these are the fields its `documents.js`
 * builds.
 */
interface DocxElement {
  type: string;
  children?: DocxElement[];
  /** `text` elements. */
  value?: string;
  /** `run` elements: the `w:rFonts w:ascii` set directly on the run. */
  font?: string | null;
  /** `run` and `paragraph` elements. */
  styleId?: string | null;
  /** `break` elements: "line", "page" or "column". */
  breakType?: string;
}

/** Warnings about mapping styles to HTML — this extractor produces no HTML. */
const HTML_ONLY_WARNING = /^Unrecognised (paragraph|run|table) style:/;

/** Image bytes are never needed; this skips reading them. */
const SKIP_IMAGES = mammoth.images.imgElement(async () => ({ src: "" }));

/**
 * Flattens the document to font-tagged runs, producing the same text
 * `mammoth.extractRawText` does (a paragraph ends with "\n\n", a tab is
 * "\t"), plus "\n" for a line or page break, which raw text drops.
 *
 * A run's font is the one set directly on it — how Word records a font the
 * user picked, and so how SutonnyMJ Bengali is almost always marked. A run
 * without one inherits its font from a style mammoth does not resolve, so it
 * is keyed by that style and left to `classifyFonts` to judge by content.
 */
function collectRuns(element: DocxElement, runs: SourceRun[], context: { fontKey: string; fontName: string | null; paragraphStyle: string | null }) {
  switch (element.type) {
    case "text":
      if (element.value) runs.push({ text: element.value, fontKey: context.fontKey, fontName: context.fontName });
      return;
    case "tab":
      runs.push({ text: "\t", fontKey: "layout" });
      return;
    case "break":
      runs.push({ text: "\n", fontKey: "layout" });
      return;
    case "paragraph": {
      const inner = { ...context, paragraphStyle: element.styleId ?? null };
      for (const child of element.children ?? []) collectRuns(child, runs, inner);
      runs.push({ text: "\n\n", fontKey: "layout" });
      return;
    }
    case "run": {
      const font = element.font?.trim() || null;
      const style = element.styleId ?? context.paragraphStyle;
      const inner = {
        ...context,
        fontName: font,
        fontKey: font ? `font:${font}` : `style:${style ?? "default"}`,
      };
      for (const child of element.children ?? []) collectRuns(child, runs, inner);
      return;
    }
    default:
      for (const child of element.children ?? []) collectRuns(child, runs, context);
  }
}

/**
 * Extracts a `.docx`'s text as font-tagged runs via `mammoth`. Runs
 * server-only — never import this from a client component.
 *
 * Runs, not one flat string, for the same reason as a PDF: a legacy Bengali
 * Word document is SutonnyMJ Bengali beside Times New Roman English, and
 * only the font says which bytes to convert (`engine/fontRuns.ts`).
 */
export async function extractDocxText(buffer: Buffer, fileName: string): Promise<Result<ExtractedDocument>> {
  let document: DocxElement | undefined;
  let messages: { type: string; message: string }[];
  try {
    ({ messages } = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: SKIP_IMAGES,
        transformDocument: (element: DocxElement) => {
          document = element;
          return element;
        },
      },
    ));
  } catch (cause) {
    return err(
      AppErrors.fileProcessing("Could not read this .docx file — it may be corrupted.", {
        details: { fileName, fileType: "docx", reason: "corrupted" },
        debug: cause,
      }),
    );
  }

  const runs: SourceRun[] = [];
  if (document) collectRuns(document, runs, { fontKey: "default", fontName: null, paragraphStyle: null });
  const text = runs.map((run) => run.text).join("");

  if (text.trim().length === 0) {
    return err(
      AppErrors.fileProcessing("This document has no extractable text.", {
        details: { fileName, fileType: "docx", reason: "empty" },
      }),
    );
  }

  const notes = messages
    .filter((message) => message.type === "warning" && !HTML_ONLY_WARNING.test(message.message))
    .map((message) => message.message);

  // With no font named anywhere (a document typed entirely in a style's
  // font), runs say nothing the flat text does not, and content-only
  // classification would leave short Bijoy unconverted; the
  // single-encoding path converted such documents before and still does.
  const hasFontNames = runs.some((run) => run.fontName);

  return ok({
    text,
    fileName,
    fileType: "docx",
    runs: hasFontNames ? runs : undefined,
    notes: notes.length > 0 ? notes : undefined,
  });
}
