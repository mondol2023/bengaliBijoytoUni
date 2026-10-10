import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { looksLikeGlyphOrderText } from "@/features/converter/engine/diagnose";
import type { SourceRun } from "@/features/converter/engine/fontRuns";
import { AppErrors, err, ok, type Result } from "@/lib/errors/types";
import type { ExtractedDocument } from "./types";

/**
 * Time allowed for resolving real font names. pdf.js only loads a font's
 * name while building the page's operator list, which also prepares the
 * page's images — ~100ms on an image-heavy page. Past the budget, pages
 * still extract, keyed by pdf.js's per-document font id, and their fonts are
 * classified by content alone (`classifyFonts`), so a long document degrades
 * rather than timing the function out.
 */
const FONT_RESOLUTION_BUDGET_MS = 6_000;

/**
 * A page painting this many separate images is almost certainly drawing
 * lines of text as pictures — some court PDFs rasterize every line of
 * complex-script Bengali — rather than holding a few figures.
 */
const IMAGE_TEXT_PAINTS_PER_PAGE = 15;

/** Less text than this on a page in one font is too little to judge. */
const MIN_NO_TEXT_MAP_CHARS = 20;
/** Share of C0 control characters no real text layer ever has. */
const MIN_CONTROL_SHARE = 0.1;
const C0_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;
const BENGALI = /[ঀ-৿]/u;

/**
 * True for one font's text on a page when it is glyph codes, not letters: an
 * embedded subset font with no text map (`ToUnicode`), so pdf.js hands back
 * the font's internal codes in order of first use. WP 6736/2020 sets its
 * quoted Bengali notices in such a Vrinda subset, and pages 9–11 and 13 came
 * back about half C0 control characters with `! " # $` between them.
 * No encoding table can read that; only the page image can.
 */
export function isNoTextMapText(text: string): boolean {
  const chars = [...text].filter((char) => !/\s/u.test(char));
  if (chars.length < MIN_NO_TEXT_MAP_CHARS || BENGALI.test(text)) return false;
  const controls = chars.filter((char) => C0_CONTROL.test(char)).length;
  return controls / chars.length >= MIN_CONTROL_SHARE || looksLikeGlyphOrderText(text);
}

interface PdfTextItem {
  str: string;
  fontName: string;
  transform: number[];
  height: number;
  hasEOL: boolean;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

/** "2, 3, 4, 7" → "2–4, 7". */
export function formatPageList(pages: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j;
  }
  return parts.join(", ");
}

/**
 * Extracts a PDF's text as font-tagged runs via `unpdf` (a serverless-friendly
 * pdf.js wrapper). Runs server-only — never import this from a client
 * component.
 *
 * Runs, not one flat string, because a legacy Bengali document is two
 * scripts set in different fonts, and only the font says which bytes are
 * Bengali (see `features/converter/engine/fontRuns.ts`). Line breaks are
 * rebuilt from item positions: pdf.js does not flag an end-of-line between
 * separately positioned lines such as a centred court heading.
 */
export async function extractPdfText(buffer: Buffer, fileName: string): Promise<Result<ExtractedDocument>> {
  const runs: SourceRun[] = [];
  const imageTextPages: number[] = [];
  const noTextMapPages: number[] = [];
  let totalPages: number;

  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { OPS } = await getResolvedPDFJS();
    const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject]);
    const deadline = Date.now() + FONT_RESOLUTION_BUDGET_MS;
    totalPages = pdf.numPages;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      if (Date.now() < deadline) {
        const operators = await page.getOperatorList();
        const imagePaints = operators.fnArray.filter((fn) => imageOps.has(fn)).length;
        if (imagePaints >= IMAGE_TEXT_PAINTS_PER_PAGE) imageTextPages.push(pageNumber);
      }

      const fontNames = new Map<string, string | null>();
      const fontNameOf = (fontKey: string): string | null => {
        if (!fontNames.has(fontKey)) {
          let name: string | null = null;
          try {
            if (page.commonObjs.has(fontKey)) name = (page.commonObjs.get(fontKey) as { name?: string })?.name ?? null;
          } catch {
            name = null;
          }
          fontNames.set(fontKey, name);
        }
        return fontNames.get(fontKey)!;
      };

      if (pageNumber > 1) runs.push({ text: "\n\n", fontKey: "layout" });

      const textByFont = new Map<string, string>();
      let previous: { y: number; height: number; endedLine: boolean } | null = null;
      for (const item of content.items) {
        if (!isTextItem(item) || item.str.length === 0) {
          // pdf.js marks a line end with an empty item; the position check
          // below would mark the same break again.
          if (isTextItem(item) && item.hasEOL && previous && !previous.endedLine) {
            runs.push({ text: "\n", fontKey: "layout" });
            previous.endedLine = true;
          }
          continue;
        }
        const y = item.transform[5];
        const height = item.height || Math.abs(item.transform[3]) || 10;
        if (previous && !previous.endedLine && Math.abs(y - previous.y) > Math.max(height, previous.height) * 0.6) {
          runs.push({ text: "\n", fontKey: "layout" });
        }
        runs.push({ text: item.str, fontKey: item.fontName, fontName: fontNameOf(item.fontName) });
        textByFont.set(item.fontName, (textByFont.get(item.fontName) ?? "") + item.str + " ");
        if (item.hasEOL) runs.push({ text: "\n", fontKey: "layout" });
        previous = { y, height, endedLine: item.hasEOL };
      }
      if ([...textByFont.values()].some(isNoTextMapText)) noTextMapPages.push(pageNumber);
    }
  } catch (cause) {
    return err(
      AppErrors.fileProcessing("Could not read this PDF — it may be corrupted or password-protected.", {
        details: { fileName, fileType: "pdf", reason: "corrupted" },
        debug: cause,
      }),
    );
  }

  const text = runs.map((run) => run.text).join("");
  const notes: string[] = [];
  if (imageTextPages.length > 0) {
    notes.push(
      `${imageTextPages.length === 1 ? "Page" : "Pages"} ${formatPageList(imageTextPages)} draw their text as images, ` +
        "not as selectable text. That text is not in the PDF's text layer, so it cannot be converted here — " +
        "the result covers only the selectable text.",
    );
  }

  if (noTextMapPages.length > 0) {
    notes.push(
      `${noTextMapPages.length === 1 ? "Page" : "Pages"} ${formatPageList(noTextMapPages)} set some text in a font ` +
        "with no text map, so the PDF stores glyph codes instead of letters. That text cannot be converted and " +
        "comes through as symbols — read those pages with the OCR tool.",
    );
  }

  if (text.trim().length === 0) {
    return err(
      AppErrors.fileProcessing(
        "This PDF has no extractable text — it may be a scanned image without OCR.",
        { details: { fileName, fileType: "pdf", reason: "empty" } },
      ),
    );
  }

  return ok({
    text,
    runs,
    fileName,
    fileType: "pdf",
    pageCount: totalPages,
    imageTextPages,
    noTextMapPages,
    notes: notes.length > 0 ? notes : undefined,
  });
}
