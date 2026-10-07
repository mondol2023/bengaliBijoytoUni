import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOcrEngine } from "../engine/tesseract";
import type { OcrEngine } from "../engine/tesseract";
import { createTesseractWorkerFactory, wordsFromBlocks } from "../engine/tesseractWorker";
import type { RawImage } from "../types";

describe("wordsFromBlocks", () => {
  it("flattens blocks, paragraphs and lines into one word list in reading order", () => {
    const words = wordsFromBlocks([
      {
        paragraphs: [
          {
            lines: [
              { words: [{ text: "আমি", confidence: 91.5 }, { text: "ভাত", confidence: 88 }] },
              { words: [{ text: "খাই", confidence: 40 }] },
            ],
          },
        ],
      },
      { paragraphs: [{ lines: [{ words: [{ text: "ok", confidence: 99 }] }] }] },
    ]);
    expect(words).toEqual([
      { text: "আমি", confidence: 91.5 },
      { text: "ভাত", confidence: 88 },
      { text: "খাই", confidence: 40 },
      { text: "ok", confidence: 99 },
    ]);
  });

  it("returns no words when Tesseract reports no blocks", () => {
    expect(wordsFromBlocks(null)).toEqual([]);
    expect(wordsFromBlocks([])).toEqual([]);
  });
});

/**
 * Real Tesseract, real WASM, real language data from the npm packages (no
 * network). Draws English text with whatever sans-serif the machine has, so
 * it proves the wiring — BMP bytes in, text and per-word confidence out —
 * rather than Bengali accuracy, which the Phase 0 spike measured.
 */
describe("createTesseractWorkerFactory (real Tesseract)", () => {
  let langDir: string;
  let engine: OcrEngine;

  beforeAll(() => {
    langDir = mkdtempSync(path.join(tmpdir(), "c2u-ocr-lang-"));
    for (const lang of ["ben", "eng"]) {
      copyFileSync(
        path.resolve(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`),
        path.join(langDir, `${lang}.traineddata.gz`),
      );
    }
    engine = createOcrEngine(createTesseractWorkerFactory({ langPath: langDir, cacheMethod: "none" }), {
      poolSize: 1,
    });
  });

  afterAll(async () => {
    await engine.dispose();
    rmSync(langDir, { recursive: true, force: true });
  });

  function textImage(text: string): RawImage {
    const canvas = createCanvas(700, 160);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 700, 160);
    context.fillStyle = "black";
    context.font = "64px sans-serif";
    context.fillText(text, 30, 100);
    const { width, height, data } = context.getImageData(0, 0, 700, 160);
    return { width, height, data: new Uint8ClampedArray(data) };
  }

  it("reads English text through ben+eng and reports per-word confidence", async () => {
    const result = await engine.recognize(textImage("Hello world"), "ben+eng");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toMatch(/Hello/i);
    expect(result.value.confidence).toBeGreaterThan(60);
    expect(result.value.words.length).toBeGreaterThanOrEqual(2);
    expect(result.value.words[0].confidence).toBeGreaterThan(0);
  }, 60_000);

  it("returns an empty result, not an error, for a blank image", async () => {
    const blank: RawImage = { width: 300, height: 100, data: new Uint8ClampedArray(300 * 100 * 4).fill(255) };
    const result = await engine.recognize(blank, "ben");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text.trim()).toBe("");
  }, 60_000);

  it("reports start-up failure when the language data is missing", async () => {
    const broken = createOcrEngine(
      createTesseractWorkerFactory({ langPath: path.join(langDir, "nowhere"), cacheMethod: "none" }),
      { poolSize: 1 },
    );
    const result = await broken.warmUp("ben");
    expect(result.ok).toBe(false);
    await broken.dispose();
  }, 60_000);
});
