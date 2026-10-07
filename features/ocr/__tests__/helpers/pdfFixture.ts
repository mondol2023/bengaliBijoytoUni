import { deflateSync } from "node:zlib";

/**
 * A minimal PDF writer for fixtures: pages of raw content-stream operators
 * plus Flate-compressed RGB image XObjects. Coordinates in `content` are PDF
 * user space — origin bottom-left, y up.
 */
export interface FixtureImage {
  width: number;
  height: number;
  /** width × height × 3 bytes, top row first. */
  rgb: Uint8Array;
}

export interface FixturePage {
  width: number;
  height: number;
  /** Content stream; paint an image with `/<name> Do`. */
  content: string;
  /** Names (keys of `images`) this page may paint. Defaults to all. */
  uses?: string[];
}

export function solidRgb(width: number, height: number, [r, g, b]: [number, number, number]): FixtureImage {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set([r, g, b], i * 3);
  return { width, height, rgb };
}

/** An image whose pixels follow `pixel(x, y)` — for orientation and distinct-hash cases. */
export function patternRgb(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): FixtureImage {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgb.set(pixel(x, y), (y * width + x) * 3);
  }
  return { width, height, rgb };
}

export function buildPdf(pages: FixturePage[], images: Record<string, FixtureImage> = {}): Uint8Array {
  const objects: Buffer[] = [];
  const add = (body: string | Buffer): number => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
    return objects.length; // object numbers are 1-based
  };
  const stream = (dict: string, data: Buffer): Buffer =>
    Buffer.concat([
      Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"),
      data,
      Buffer.from("\nendstream", "latin1"),
    ]);

  // 1 = catalog, 2 = pages tree; filled in once the page objects are known.
  add("");
  add("");

  const imageObjects = new Map<string, number>();
  for (const [name, image] of Object.entries(images)) {
    const dict = `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`;
    imageObjects.set(name, add(stream(dict, deflateSync(Buffer.from(image.rgb)))));
  }

  const pageObjects: number[] = [];
  for (const page of pages) {
    const contents = add(stream("", Buffer.from(page.content, "latin1")));
    const xobjects = (page.uses ?? [...imageObjects.keys()])
      .map((name) => `/${name} ${imageObjects.get(name)} 0 R`)
      .join(" ");
    pageObjects.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents ${contents} 0 R /Resources << /XObject << ${xobjects} >> >> >>`,
      ),
    );
  }

  objects[0] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1");
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageObjects.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageObjects.length} >>`,
    "latin1",
  );

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const wrapped = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(wrapped);
    length += wrapped.length;
  });

  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`]
    .concat(offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`))
    .join("");
  chunks.push(
    Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`, "latin1"),
  );
  return new Uint8Array(Buffer.concat(chunks));
}
