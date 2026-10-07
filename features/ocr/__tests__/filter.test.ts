import { describe, expect, it } from "vitest";
import { OCR_MAX_ITEMS, OCR_ROW_TOLERANCE_PT } from "../config";
import {
  dedupeByHash,
  dedupeRepeatedPlacements,
  groupIntoRows,
  isDecorative,
  planEmbeddedRows,
  planUnplacedImages,
} from "../extract/filter";
import type { ImageInfo, PlacedImage } from "../types";

/** A court-PDF line fragment: ~138 px tall at 2 px/pt, so 69 pt tall. */
function strip(over: Partial<PlacedImage> & { hash: string }): PlacedImage {
  return { page: 1, x: 50, y: 100, width: 150, height: 69, pxWidth: 300, pxHeight: 138, ...over };
}

function info(pxWidth: number, pxHeight: number, hash = `${pxWidth}x${pxHeight}`): ImageInfo {
  return { pxWidth, pxHeight, hash };
}

describe("isDecorative", () => {
  it("drops an image with a side under 48 px", () => {
    expect(isDecorative(info(47, 600))).toBe(true);
    expect(isDecorative(info(2000, 40))).toBe(true);
  });

  it("drops an image under ~3 000 px² even when both sides pass", () => {
    expect(isDecorative(info(48, 62))).toBe(true); // 2 976
    expect(isDecorative(info(48, 63))).toBe(false); // 3 024
  });

  it("keeps the smallest real court-PDF fragment (60 × 138)", () => {
    expect(isDecorative(info(60, 138))).toBe(false);
  });
});

describe("dedupeByHash", () => {
  it("keeps the first of each hash, in input order", () => {
    const a1 = { hash: "a", n: 1 };
    const b = { hash: "b", n: 2 };
    const a2 = { hash: "a", n: 3 };
    expect(dedupeByHash([a1, b, a2])).toEqual([a1, b]);
  });
});

describe("dedupeRepeatedPlacements", () => {
  it("drops a logo repeated at the same spot on every page", () => {
    const logos = [1, 2, 3].map((page) => strip({ hash: "logo", page, x: 40, y: 20 }));
    expect(dedupeRepeatedPlacements(logos)).toEqual([logos[0]]);
  });

  it("treats a few points of drift as the same spot", () => {
    const a = strip({ hash: "logo", page: 1, x: 40, y: 20 });
    const b = strip({ hash: "logo", page: 2, x: 41.5, y: 21 });
    expect(dedupeRepeatedPlacements([a, b])).toEqual([a]);
  });

  it("keeps identical pixels at different spots — the same glyph strip really can recur in a line", () => {
    const first = strip({ hash: "danda", x: 50, y: 100 });
    const second = strip({ hash: "danda", x: 300, y: 100 });
    expect(dedupeRepeatedPlacements([first, second])).toEqual([first, second]);
  });

  it("keeps different images at the same spot", () => {
    const a = strip({ hash: "a" });
    const b = strip({ hash: "b" });
    expect(dedupeRepeatedPlacements([a, b])).toEqual([a, b]);
  });
});

describe("groupIntoRows", () => {
  it("joins fragments within the row tolerance and orders them left to right", () => {
    const right = strip({ hash: "r", x: 250, y: 102 });
    const left = strip({ hash: "l", x: 50, y: 100 });
    const mid = strip({ hash: "m", x: 150, y: 100 + OCR_ROW_TOLERANCE_PT });
    const rows = groupIntoRows([right, left, mid]);
    expect(rows).toHaveLength(1);
    expect(rows[0].fragments.map((f) => f.hash)).toEqual(["l", "m", "r"]);
    expect(rows[0].page).toBe(1);
  });

  it("starts a new row just past the tolerance", () => {
    const a = strip({ hash: "a", y: 100 });
    const b = strip({ hash: "b", y: 100 + OCR_ROW_TOLERANCE_PT + 1 });
    expect(groupIntoRows([a, b]).map((r) => r.fragments.map((f) => f.hash))).toEqual([["a"], ["b"]]);
  });

  it("does not let a chain of small steps drift one row down the page", () => {
    // 100, 105, 110: each step is inside the tolerance but 110 is 10 pt from the row's top.
    const rows = groupIntoRows([100, 105, 110].map((y) => strip({ hash: `y${y}`, y })));
    expect(rows.map((r) => r.fragments.length)).toEqual([2, 1]);
  });

  it("never mixes pages, and returns rows in page then top-to-bottom order", () => {
    const p2 = strip({ hash: "p2", page: 2, y: 10 });
    const p1low = strip({ hash: "p1low", page: 1, y: 400 });
    const p1high = strip({ hash: "p1high", page: 1, y: 50 });
    expect(groupIntoRows([p2, p1low, p1high]).map((r) => r.fragments[0].hash)).toEqual(["p1high", "p1low", "p2"]);
  });

  it("reports the union box of a row's fragments", () => {
    const left = strip({ hash: "l", x: 50, y: 100, width: 100, height: 60 });
    const right = strip({ hash: "r", x: 140, y: 103, width: 200, height: 69 });
    expect(groupIntoRows([left, right])[0].box).toEqual({ x: 50, y: 100, width: 290, height: 72 });
  });

  it("returns nothing for nothing", () => {
    expect(groupIntoRows([])).toEqual([]);
  });
});

describe("planEmbeddedRows", () => {
  it("turns a court page's fragments into rows, minus logos, icons and a lone hyphen", () => {
    const fragments: PlacedImage[] = [
      // Letterhead logo, repeated on both pages at the same spot.
      strip({ hash: "logo", page: 1, x: 40, y: 20, width: 80, height: 40, pxWidth: 160, pxHeight: 80 }),
      strip({ hash: "logo", page: 2, x: 40, y: 20, width: 80, height: 40, pxWidth: 160, pxHeight: 80 }),
      // Tiny bullet icon.
      strip({ hash: "bullet", x: 30, y: 100, width: 10, height: 10, pxWidth: 20, pxHeight: 20 }),
      // One text line drawn as three fragments (out of order).
      strip({ hash: "line-c", x: 400, y: 101, width: 200, height: 69, pxWidth: 400, pxHeight: 138 }),
      strip({ hash: "line-a", x: 50, y: 100, width: 200, height: 69, pxWidth: 400, pxHeight: 138 }),
      strip({ hash: "line-b", x: 240, y: 100, width: 200, height: 69, pxWidth: 400, pxHeight: 138 }),
      // A lone hyphen on its own row: passes the size filter, fails the row-area minimum.
      strip({ hash: "hyphen", x: 50, y: 300, width: 30, height: 69, pxWidth: 60, pxHeight: 138 }),
      // A second real line further down.
      strip({ hash: "line2", x: 50, y: 200, width: 500, height: 69, pxWidth: 1000, pxHeight: 138 }),
    ];

    const result = planEmbeddedRows(fragments);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.rows.map((r) => r.fragments.map((f) => f.hash))).toEqual([
      ["logo"],
      ["line-a", "line-b", "line-c"],
      ["line2"],
    ]);
    expect(result.value.skipped).toEqual({ decorative: 1, duplicate: 1, tinyRow: 1 });
  });

  it("returns an empty plan, not an error, when the file has no images", () => {
    expect(planEmbeddedRows([])).toEqual({
      ok: true,
      value: { rows: [], skipped: { decorative: 0, duplicate: 0, tinyRow: 0 } },
    });
  });

  it("ignores a fragment drawn with no area on the page", () => {
    const result = planEmbeddedRows([strip({ hash: "flat", width: 0 }), strip({ hash: "flat2", height: 0 })]);
    expect(result).toEqual({
      ok: true,
      value: { rows: [], skipped: { decorative: 2, duplicate: 0, tinyRow: 0 } },
    });
  });

  it("refuses a file whose rows exceed the item cap, with a user-safe error", () => {
    const fragments = Array.from({ length: OCR_MAX_ITEMS + 1 }, (_, i) =>
      strip({ hash: `row${i}`, y: i * 100, width: 500, pxWidth: 1000 }),
    );
    const result = planEmbeddedRows(fragments);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
    expect(result.error.message).toContain(String(OCR_MAX_ITEMS));
  });
});

describe("planUnplacedImages", () => {
  it("keeps document order, dropping icons and byte-identical repeats", () => {
    const logo = info(400, 120, "logo");
    const body = info(1200, 900, "body");
    const icon = info(24, 24, "icon");
    const result = planUnplacedImages([logo, icon, body, { ...logo }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toEqual([logo, body]);
    expect(result.value.skipped).toEqual({ decorative: 1, duplicate: 1 });
  });

  it("returns an empty plan for a DOCX with no images", () => {
    expect(planUnplacedImages([])).toEqual({
      ok: true,
      value: { items: [], skipped: { decorative: 0, duplicate: 0 } },
    });
  });

  it("refuses more images than the item cap", () => {
    const many = Array.from({ length: OCR_MAX_ITEMS + 1 }, (_, i) => info(500, 500, `img${i}`));
    const result = planUnplacedImages(many);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ reason: "too_large" });
  });
});
