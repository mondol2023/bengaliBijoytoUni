import { describe, expect, it } from "vitest";
import { planBatches } from "../fallback/batching";

const LIMITS = { maxImagesPerRequest: 4, maxRequestBytes: 3_800_000, maxImagesPerJob: 40 };
const crops = (n: number, bytes: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, bytes }));

describe("planBatches", () => {
  it("splits by image count, in order", () => {
    const { batches, deferred } = planBatches(crops(10, 100_000), LIMITS);
    expect(batches.map((b) => b.length)).toEqual([4, 4, 2]);
    expect(batches.flat()).toEqual(crops(10, 0).map((c) => c.id));
    expect(deferred).toEqual([]);
  });

  it("keeps crops together while they fit under the byte limit", () => {
    const { batches } = planBatches(crops(3, 1_200_000), LIMITS);
    expect(batches.map((b) => b.length)).toEqual([3]);
  });

  it("counts ~2 KB of multipart overhead per image at the byte boundary", () => {
    // 3 x 1_266_000 = 3_798_000 fits the limit on payload alone; with 3 x 2_048
    // of framing it does not, so the third crop starts a new batch.
    const over = planBatches(crops(3, 1_266_000), LIMITS);
    expect(over.batches.map((b) => b.length)).toEqual([2, 1]);
    // 3 x (1_265_000 + 2_048) = 3_801_144 is still over; 3 x (1_264_000 + 2_048) fits.
    expect(planBatches(crops(3, 1_265_000), LIMITS).batches.map((b) => b.length)).toEqual([2, 1]);
    expect(planBatches(crops(3, 1_264_000), LIMITS).batches.map((b) => b.length)).toEqual([3]);
  });

  it("sends a crop larger than the request limit alone instead of dropping it", () => {
    const { batches } = planBatches(
      [
        { id: "a", bytes: 100 },
        { id: "huge", bytes: 5_000_000 },
        { id: "b", bytes: 100 },
      ],
      LIMITS,
    );
    expect(batches).toEqual([["a"], ["huge"], ["b"]]);
  });

  it("batches the first maxImagesPerJob crops and defers the rest, in order", () => {
    const { batches, deferred } = planBatches(crops(50, 1_000), LIMITS);
    expect(batches.flat()).toHaveLength(40);
    expect(batches.flat()[39]).toBe("c39");
    expect(deferred).toEqual(crops(50, 0).slice(40).map((c) => c.id));
  });

  it("returns nothing for no crops", () => {
    expect(planBatches([], LIMITS)).toEqual({ batches: [], deferred: [] });
  });
});
