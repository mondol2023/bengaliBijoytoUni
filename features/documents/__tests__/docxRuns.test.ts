/**
 * A .docx carries the font of every run, and a legacy Bengali Word document
 * mixes SutonnyMJ Bengali with Times New Roman English — so, like a PDF, it
 * must arrive as font-tagged runs, or the English is converted to garbage.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { convertRuns } from "@/features/converter/engine/fontRuns";
import { extractDocxText } from "../extract/docx";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function run(text: string, font?: string, extra = ""): string {
  const props = font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr>` : "";
  return `<w:r>${props}${extra}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

async function docx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${paragraphs
      .map((p) => `<w:p>${p}</w:p>`)
      .join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractDocxText font runs", () => {
  it("tags each run with its font, joining to the flat text exactly", async () => {
    const buffer = await docx([
      run("Rbve wePvicwZ ", "SutonnyMJ") + run("Call for the records", "Times New Roman"),
      run("Avwg", "SutonnyMJ") + run("", undefined, "<w:tab/>") + run("x", "SutonnyMJ"),
    ]);
    const result = await extractDocxText(buffer, "order.docx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { text, runs } = result.value;
    expect(runs).toBeDefined();
    expect(runs!.map((r) => r.text).join("")).toBe(text);
    expect(text).toBe("Rbve wePvicwZ Call for the records\n\nAvwg\tx\n\n");
    expect(runs!.find((r) => r.text === "Call for the records")?.fontName).toBe("Times New Roman");
    expect(runs!.find((r) => r.text === "Rbve wePvicwZ ")?.fontName).toBe("SutonnyMJ");
  });

  it("converts the SutonnyMJ Bengali and leaves the English alone", async () => {
    const buffer = await docx([run("Rbve wePvicwZ ", "SutonnyMJ") + run("Call for the records", "Times New Roman")]);
    const result = await extractDocxText(buffer, "order.docx");
    expect(result.ok && result.value.runs).toBeTruthy();
    if (!result.ok) return;

    const converted = convertRuns(result.value.runs!);
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.value.unicodeText).toContain("জনাব বিচারপতি");
    expect(converted.value.unicodeText).toContain("Call for the records");
  });

  it("keys runs without a direct font by their style, so content decides them", async () => {
    const styled = `<w:r><w:rPr><w:rStyle w:val="Quote"/></w:rPr><w:t>The petitioner was not heard by the court below in this matter.</w:t></w:r>`;
    const buffer = await docx([run("Rbve wePvicwZ ", "SutonnyMJ") + styled]);
    const result = await extractDocxText(buffer, "order.docx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quoted = result.value.runs!.find((r) => r.text.startsWith("The petitioner"))!;
    expect(quoted.fontName ?? null).toBeNull();
    expect(quoted.fontKey).toBe("style:Quote");

    const converted = convertRuns(result.value.runs!);
    expect(converted.ok && converted.value.unicodeText).toContain("The petitioner was not heard");
  });

  it("keeps the single-encoding path for a document that names no font at all", async () => {
    const result = await extractDocxText(await docx([run("Avwg evsjvq Mvb MvB")]), "plain.docx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runs).toBeUndefined();
    expect(result.value.text).toBe("Avwg evsjvq Mvb MvB\n\n");
  });

  it("does not surface HTML-mapping warnings about unknown styles", async () => {
    const styled = `<w:pPr><w:pStyle w:val="BodyText"/></w:pPr>${run("Avwg", "SutonnyMJ")}`;
    const result = await extractDocxText(await docx([styled]), "order.docx");
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value.notes ?? []).some((n) => /Unrecognised/.test(n))).toBe(false);
  });
});
