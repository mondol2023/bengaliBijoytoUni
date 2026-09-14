/**
 * Deterministic low-poly triangulation for the site-wide "foundry ground" —
 * the paper's own texture, not a decorative layer laid on top of it. Every
 * facet is a sliver of `--foreground` over `--background` at 2-9% opacity,
 * never a new hue, so it reads as grain in the stock the specimens are
 * printed on. Seeded with a fixed integer (no `Math.random`, no `Date.now`)
 * so the mesh is byte-identical on the server render and the client render —
 * no hydration mismatch, no layout shift.
 */

export interface GroundTriangle {
  /** "x1,y1 x2,y2 x3,y3" — ready for a `<polygon points>` attribute. */
  points: string;
  opacity: number;
}

export interface GroundMesh {
  width: number;
  height: number;
  /** Overscan beyond the design canvas so the ambient drift never reveals an edge. */
  margin: number;
  triangles: GroundTriangle[];
}

const SEED = 0x9e3779b9;

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

const WIDTH = 1600;
const HEIGHT = 1000;
const MARGIN = 70;
const COLS = 15;
const ROWS = 9;
/** Fraction of a cell's own size a corner may wander — organic facets, not a diamond grid. */
const JITTER = 0.34;
const OPACITY_MIN = 0.018;
const OPACITY_MAX = 0.085;

interface Point {
  x: number;
  y: number;
}

function buildGroundMesh(): GroundMesh {
  const random = mulberry32(SEED);
  const spanX = WIDTH + MARGIN * 2;
  const spanY = HEIGHT + MARGIN * 2;
  const cellW = spanX / COLS;
  const cellH = spanY / ROWS;

  const grid: Point[][] = [];
  for (let row = 0; row <= ROWS; row++) {
    const line: Point[] = [];
    for (let col = 0; col <= COLS; col++) {
      const baseX = -MARGIN + col * cellW;
      const baseY = -MARGIN + row * cellH;
      line.push({
        x: baseX + (random() - 0.5) * 2 * JITTER * cellW,
        y: baseY + (random() - 0.5) * 2 * JITTER * cellH,
      });
    }
    grid.push(line);
  }

  const format = (p: Point) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

  // Gently darkens (or, in dark mode, lightens) toward the lower right, like
  // a single soft light source — plus per-facet jitter so triangles catch it
  // unevenly instead of banding smoothly.
  const facetOpacity = (cx: number, cy: number) => {
    const nx = (cx + MARGIN) / spanX;
    const ny = (cy + MARGIN) / spanY;
    const lightBias = nx * 0.35 + ny * 0.45;
    const sparkle = (random() - 0.5) * 0.7;
    const t = Math.min(1, Math.max(0, lightBias + sparkle * 0.5));
    return Number((OPACITY_MIN + t * (OPACITY_MAX - OPACITY_MIN)).toFixed(3));
  };

  const triangles: GroundTriangle[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const tl = grid[row][col];
      const tr = grid[row][col + 1];
      const bl = grid[row + 1][col];
      const br = grid[row + 1][col + 1];
      // Alternate which diagonal splits the quad so the mesh doesn't read as
      // a uniform diamond lattice.
      const splitTlBr = random() > 0.5;
      const halves = splitTlBr ? [[tl, tr, br], [tl, br, bl]] : [[tl, tr, bl], [tr, br, bl]];

      for (const tri of halves) {
        const cx = (tri[0].x + tri[1].x + tri[2].x) / 3;
        const cy = (tri[0].y + tri[1].y + tri[2].y) / 3;
        triangles.push({
          points: tri.map(format).join(" "),
          opacity: facetOpacity(cx, cy),
        });
      }
    }
  }

  return { width: WIDTH, height: HEIGHT, margin: MARGIN, triangles };
}

export const groundMesh: GroundMesh = buildGroundMesh();
