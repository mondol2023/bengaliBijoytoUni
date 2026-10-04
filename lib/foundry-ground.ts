/**
 * Deterministic low-poly tiles for the site-wide "foundry ground" — the
 * paper's own faceted texture.
 *
 * Each tile is periodic in both directions (the grid's last row and column
 * are its first, shifted by one tile), so it repeats without a seam and the
 * ground can travel with the scroll for as long as a page is. A tile is
 * returned as an SVG data URI used as a CSS *mask*: the facets are alpha
 * only, and the colour comes from the layer's `background-color`, which is a
 * theme token — so the same tile is ink-on-paper in light mode and
 * paper-on-ink in dark mode without a second asset.
 *
 * Seeded with fixed integers (no `Math.random`, no `Date.now`), so server and
 * client produce byte-identical markup — no hydration mismatch.
 */

/** mulberry32 — small, fast, and deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Escapes only what a data URI inside `url("…")` cannot carry raw. The SVG
 * uses single quotes throughout, so this stays far smaller than
 * `encodeURIComponent` — the masks ride inline on every page.
 */
function escapeSvg(svg: string): string {
  return svg.replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E");
}

interface Point {
  x: number;
  y: number;
}

interface TileSpec {
  seed: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Fraction of a cell's own size a corner may wander — organic facets, not a diamond grid. */
  jitter: number;
  /**
   * The inks this lattice is printed in. Each facet goes to at most one of
   * them — a facet's chance of each is its `density` — and the rest stay
   * open paper. Inks share one lattice so their facets interlock instead of
   * overlapping.
   */
  inks: { density: number; opacityMin: number; opacityMax: number }[];
  /** Alpha of the hairline crease on every edge, drawn into the first ink; 0 draws none. */
  crease: number;
}

export interface GroundTile {
  width: number;
  height: number;
  /** `url("data:image/svg+xml,…")`, ready for `mask-image`. */
  mask: string;
}

/**
 * Builds one periodic tile. Facets that straddle the tile's edge are drawn
 * again, shifted by a tile, so the part that falls off one side reappears on
 * the other — that is what makes the repeat seamless.
 */
function buildTiles(spec: TileSpec): GroundTile[] {
  const random = mulberry32(spec.seed);
  const { width: W, height: H, cols, rows } = spec;
  const cellW = W / cols;
  const cellH = H / rows;

  // Jitter only the interior lattice; the wrap row/column copy row/column 0.
  const base: Point[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: Point[] = [];
    for (let col = 0; col < cols; col++) {
      line.push({
        x: col * cellW + (random() - 0.5) * 2 * spec.jitter * cellW,
        y: row * cellH + (random() - 0.5) * 2 * spec.jitter * cellH,
      });
    }
    base.push(line);
  }
  const at = (row: number, col: number): Point => {
    const p = base[row % rows][col % cols];
    return { x: p.x + (col >= cols ? W : 0), y: p.y + (row >= rows ? H : 0) };
  };

  const shapes: string[][] = spec.inks.map(() => []);
  const draw = (ink: number, tri: Point[], alpha: number, crease: number) => {
    const xs = tri.map((p) => p.x);
    const ys = tri.map((p) => p.y);
    for (const dx of [-W, 0, W]) {
      for (const dy of [-H, 0, H]) {
        // Only the copies that actually overlap the tile.
        if (Math.max(...xs) + dx < 0 || Math.min(...xs) + dx > W) continue;
        if (Math.max(...ys) + dy < 0 || Math.min(...ys) + dy > H) continue;
        const points = tri.map((p) => `${Math.round(p.x + dx)},${Math.round(p.y + dy)}`).join(" ");
        shapes[ink].push(
          `<polygon points='${points}' fill-opacity='${alpha.toFixed(3)}'` +
            (crease > 0 ? ` stroke-opacity='${crease}'` : " stroke='none'") +
            "/>",
        );
      }
    }
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tl = at(row, col);
      const tr = at(row, col + 1);
      const bl = at(row + 1, col);
      const br = at(row + 1, col + 1);
      // Alternate the diagonal so the mesh doesn't read as a diamond lattice.
      const halves = random() > 0.5 ? [[tl, tr, br], [tl, br, bl]] : [[tl, tr, bl], [tr, br, bl]];
      for (const tri of halves) {
        // Pick at most one ink for this facet, by cumulative density.
        const roll = random();
        const t = random();
        let ink = -1;
        let floor = 0;
        for (let i = 0; i < spec.inks.length; i++) {
          floor += spec.inks[i].density;
          if (roll < floor) {
            ink = i;
            break;
          }
        }
        if (ink >= 0) {
          const { opacityMin, opacityMax } = spec.inks[ink];
          draw(ink, tri, opacityMin + t * (opacityMax - opacityMin), ink === 0 ? spec.crease : 0);
        } else if (spec.crease > 0) {
          // Open paper still carries its crease.
          draw(0, tri, 0, spec.crease);
        }
      }
    }
  }

  return shapes.map((inkShapes) => {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>` +
      `<g fill='black' stroke='black' stroke-width='1'>${inkShapes.join("")}</g></svg>`;
    return { width: W, height: H, mask: `url("data:image/svg+xml,${escapeSvg(svg)}")` };
  });
}

/**
 * The far layer: the full faceted sheet in ink, a hairline crease on every
 * edge. It moves slowest, so it reads as the paper itself.
 */
export const [farInkTile] = buildTiles({
  seed: 0x9e3779b9,
  width: 1600,
  height: 1000,
  cols: 15,
  rows: 9,
  jitter: 0.34,
  inks: [{ density: 1, opacityMin: 0.02, opacityMax: 0.085 }],
  // Every interior edge is drawn by both facets that share it, so this doubles.
  crease: 0.05,
});

/**
 * The near layer: larger, sparser facets that travel faster than the sheet
 * beneath them — the parallax that makes the ground read as depth rather
 * than wallpaper. Most of its facets are ink; a few carry the terracotta
 * accent, never enough to outweigh the ink.
 */
export const [nearInkTile, nearAccentTile] = buildTiles({
  seed: 0x85ebca6b,
  width: 2000,
  height: 1400,
  cols: 8,
  rows: 6,
  jitter: 0.3,
  inks: [
    { density: 0.3, opacityMin: 0.025, opacityMax: 0.06 },
    { density: 0.14, opacityMin: 0.045, opacityMax: 0.1 },
  ],
  crease: 0,
});
