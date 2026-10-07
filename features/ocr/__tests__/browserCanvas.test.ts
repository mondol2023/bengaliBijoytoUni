import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCanvasEnv } from "../extract/browserCanvas";

afterEach(() => vi.unstubAllGlobals());

function stubDom() {
  const contextArgs: unknown[][] = [];
  const pixels = new Uint8ClampedArray([1, 2, 3, 255]);
  const canvas = {
    width: 0,
    height: 0,
    getContext: (...args: unknown[]) => {
      contextArgs.push(args);
      return {
        drawImage: vi.fn(),
        getImageData: (_x: number, _y: number, width: number, height: number) => ({ width, height, data: pixels }),
      };
    },
  };
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  return { canvas, contextArgs };
}

describe("browserCanvasEnv", () => {
  it("creates a canvas of the requested size", () => {
    const { canvas } = stubDom();
    const made = browserCanvasEnv.createCanvas(120, 40);
    expect(made.width).toBe(120);
    expect(made.height).toBe(40);
    expect(made).toBe(canvas);
  });

  it("hints that the canvas will be read back, so the browser keeps it in CPU memory", () => {
    const { contextArgs } = stubDom();
    browserCanvasEnv.createCanvas(10, 10).getContext("2d");
    expect(contextArgs[0]).toEqual(["2d", { willReadFrequently: true }]);
  });

  it("decodes image bytes through createImageBitmap and releases the bitmap", async () => {
    stubDom();
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ width: 1, height: 1, close }));
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const image = await browserCanvasEnv.decodeImage(new Uint8Array([1, 2, 3]), "image/jpeg");
    expect(image).toEqual({ width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) });
    const blob = (createImageBitmap.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe("image/jpeg");
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns null for bytes the browser cannot decode, rather than throwing", async () => {
    stubDom();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new DOMException("bad image")));
    expect(await browserCanvasEnv.decodeImage(new Uint8Array([0]), "image/png")).toBeNull();
  });
});
