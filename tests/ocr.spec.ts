import { createCanvas } from "@napi-rs/canvas";
import { expect, test } from "@playwright/test";
import { buildPdf } from "../features/ocr/__tests__/helpers/pdfFixture";

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

test("reads a picture of text from a PDF in the browser", async ({ page }) => {
  test.setTimeout(180_000);

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
