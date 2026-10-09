import { createCanvas } from "@napi-rs/canvas";
import { expect, test, type Page } from "@playwright/test";
import { buildPdf } from "../features/ocr/__tests__/helpers/pdfFixture";
import { OCR_AI_NOTE, OCR_NOTE } from "../lib/privacy/disclosure";

const BASE_URL = process.env.OCR_E2E_BASE_URL ?? "http://localhost:3000";

/** One page that is a picture of "HELLO OCR 2025", so there is no text layer to find. */
function textPicturePdf(): Buffer {
  const width = 1200;
  const height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 140px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("HELLO OCR 2025", 40, height / 2);

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);

  const pdf = buildPdf(
    [{ width: 612, height: 204, content: "q 612 0 0 204 0 0 cm /Im1 Do Q" }],
    { Im1: { width, height, rgb } },
  );
  return Buffer.from(pdf);
}

/** Collects console errors, page errors and CSP violations; the caller asserts the list is empty. */
async function collectProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  // Site-wide, not OCR: WebKit's Firebase auth loader hits the same CSP block on every route.
  const FIREBASE_LOADER = /apis\.google\.com\/js\/api\.js/;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The Tesseract core prints these for legacy-engine parameters the LSTM data lacks; harmless noise.
    if (/^Warning: Parameter not found: /.test(message.text())) return;
    if (FIREBASE_LOADER.test(message.text())) return;
    problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  // CSP violations also reach the console, but this catches them even if the message wording changes.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return problems;
}

test("reads a picture of text from a PDF in the browser", async ({ page }) => {
  test.setTimeout(180_000);

  const problems = await collectProblems(page);

  await page.goto(`${BASE_URL}/ocr`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "hello.pdf",
    mimeType: "application/pdf",
    buffer: textPicturePdf(),
  });

  await page.getByText("Whole pages", { exact: true }).click();
  await page.getByRole("button", { name: "Read text" }).click();

  await expect(page.getByRole("list").getByText(/HELLO/i).first()).toBeVisible({ timeout: 120_000 });

  const copyAll = page.getByRole("button", { name: "Copy all" });
  await expect(copyAll).toBeEnabled();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.ocr\.txt$/);

  expect(problems).toEqual([]);
});

test("Open in Compare puts the reading in Compare's source field, once", async ({ page }) => {
  test.setTimeout(180_000);

  const problems = await collectProblems(page);

  await page.goto(`${BASE_URL}/ocr`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "hello.pdf",
    mimeType: "application/pdf",
    buffer: textPicturePdf(),
  });
  await page.getByText("Whole pages", { exact: true }).click();
  await page.getByRole("button", { name: "Read text" }).click();
  await expect(page.getByRole("list").getByText(/HELLO/i).first()).toBeVisible({ timeout: 120_000 });

  await page.getByRole("button", { name: "Open in Compare" }).click();
  await page.waitForURL("**/compare");

  const source = page.getByRole("textbox", { name: "Source" });
  await expect(source).toHaveValue(/HELLO/i);
  await expect(page.getByRole("textbox", { name: "Target" })).toHaveValue("");

  // Taken once: a reload must not bring the text back.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Source" })).toHaveValue("");

  expect(problems).toEqual([]);
});

test("Open in Compare says so, and stays put, when the browser refuses the hand-off", async ({ page }) => {
  test.setTimeout(180_000);

  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });

  await page.goto(`${BASE_URL}/ocr`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "hello.pdf",
    mimeType: "application/pdf",
    buffer: textPicturePdf(),
  });
  await page.getByText("Whole pages", { exact: true }).click();
  await page.getByRole("button", { name: "Read text" }).click();
  await expect(page.getByRole("list").getByText(/HELLO/i).first()).toBeVisible({ timeout: 120_000 });

  await page.getByRole("button", { name: "Open in Compare" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't hand this to Compare" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/ocr");
});

test("anonymous: AI improve is off, the note stays truthful, and nothing is sent to the improve route", async ({ page }) => {
  test.setTimeout(180_000);

  const problems = await collectProblems(page);
  // Counted rather than stubbed: an anonymous visitor must not reach the route at all, not even a GET probe.
  const improveRequests: string[] = [];
  await page.route("**/api/ocr/improve", async (route) => {
    improveRequests.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({ status: 401, json: { ok: false } });
  });

  await page.goto(`${BASE_URL}/ocr`);

  const toggle = page.getByRole("checkbox", { name: "Improve hard lines with AI" });
  await expect(toggle).toBeDisabled();
  await expect(toggle).not.toBeChecked();
  // The hint waits for the lazily loaded auth SDK to report "no user", which is slower under load.
  await expect(page.getByText("Sign in to use this", { exact: true })).toBeVisible({ timeout: 20_000 });

  await expect(page.getByText(OCR_NOTE.en)).toBeVisible();
  await expect(page.getByText(OCR_AI_NOTE.en)).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles({
    name: "hello.pdf",
    mimeType: "application/pdf",
    buffer: textPicturePdf(),
  });
  await page.getByText("Whole pages", { exact: true }).click();
  await page.getByRole("button", { name: "Read text" }).click();

  // The local read completes, with no AI button on any row and no "by AI" in the marker.
  await expect(page.getByRole("list").getByText(/HELLO/i).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: /Improve with AI/ })).toHaveCount(0);
  await expect(page.getByText(/by AI/)).toHaveCount(0);
  await expect(page.getByText(OCR_NOTE.en)).toBeVisible();
  await expect(page.getByText(OCR_AI_NOTE.en)).toHaveCount(0);

  expect(improveRequests).toEqual([]);
  expect(problems).toEqual([]);
});

test("the page's CSP lets it read a blob URL back (the preview upload path)", async ({ page }) => {
  const problems = await collectProblems(page);
  await page.goto(`${BASE_URL}/ocr`);

  // `loadCrop` in `hooks/useOcrJob.ts` does exactly this with a preview's blob URL before uploading it.
  const size = await page.evaluate(async () => {
    const url = URL.createObjectURL(new Blob(["0123456789"], { type: "image/jpeg" }));
    try {
      return (await (await fetch(url)).blob()).size;
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  expect(size).toBe(10);
  expect(problems).toEqual([]);
});
