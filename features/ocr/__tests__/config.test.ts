import { describe, expect, it } from "vitest";
import {
  OCR_MAX_ITEMS,
  OCR_MAX_PAGES,
  OCR_MAX_PAGE_PIXELS,
  OCR_PAGE_RENDER_SCALE,
  checkItemCap,
  checkPageCap,
  pageRenderScale,
} from "../config";

describe("pageRenderScale", () => {
  it("renders an ordinary page at the 2x the spike found as good as 3x", () => {
    expect(pageRenderScale(612, 792)).toBe(OCR_PAGE_RENDER_SCALE);
    expect(pageRenderScale(595, 842)).toBe(OCR_PAGE_RENDER_SCALE);
  });

  it("scales an oversize page down so the render stays inside the pixel cap", () => {
    const scale = pageRenderScale(5000, 5000);
    expect(scale).toBeLessThan(OCR_PAGE_RENDER_SCALE);
    expect(5000 * scale * 5000 * scale).toBeLessThanOrEqual(OCR_MAX_PAGE_PIXELS);
  });

  it("never returns a scale for a degenerate page that would divide by zero", () => {
    expect(Number.isFinite(pageRenderScale(0, 0))).toBe(true);
    expect(pageRenderScale(0, 792)).toBeGreaterThan(0);
  });
});

describe("checkPageCap", () => {
  it("accepts a page count up to the cap", () => {
    expect(checkPageCap(1)).toEqual({ ok: true, value: 1 });
    expect(checkPageCap(OCR_MAX_PAGES)).toEqual({ ok: true, value: OCR_MAX_PAGES });
  });

  it("refuses one page over the cap with a user-safe too_large error that names the limit", () => {
    const result = checkPageCap(OCR_MAX_PAGES + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
    expect(result.error.details).toMatchObject({ reason: "too_large" });
    expect(result.error.message).toContain(String(OCR_MAX_PAGES));
  });

  it("treats a file with no pages as empty", () => {
    const result = checkPageCap(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ reason: "empty" });
  });
});

describe("checkItemCap", () => {
  it("accepts up to the cap and refuses one past it", () => {
    expect(checkItemCap(OCR_MAX_ITEMS).ok).toBe(true);
    const result = checkItemCap(OCR_MAX_ITEMS + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
    expect(result.error.details).toMatchObject({ reason: "too_large" });
    expect(result.error.message).toContain(String(OCR_MAX_ITEMS));
  });

  it("accepts zero — finding nothing is the page's 'no images with text' state, not an error", () => {
    expect(checkItemCap(0).ok).toBe(true);
  });
});
