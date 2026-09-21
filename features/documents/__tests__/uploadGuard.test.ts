import { describe, expect, it } from "vitest";
import { rejectOversizeFile, rejectOversizeRequest } from "../uploadGuard";
import { MAX_UPLOAD_SIZE_BYTES } from "../config";

function requestWithLength(contentLength: string | null): Request {
  return new Request("https://example.test/api/documents/extract", {
    method: "POST",
    headers: contentLength === null ? {} : { "content-length": contentLength },
  });
}

/** A File whose reported size is decoupled from its bytes, so a 500MB upload can be modelled without allocating one. */
function fileOfSize(size: number, name = "big.pdf"): File {
  const file = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("rejectOversizeRequest", () => {
  it("rejects a declared body far over the cap, before formData() buffers it", () => {
    const error = rejectOversizeRequest(requestWithLength(String(500 * 1024 * 1024)));
    expect(error?.code).toBe("FILE_PROCESSING_ERROR");
    expect(error?.details?.reason).toBe("too_large");
  });

  it("allows a body at exactly the cap, whose multipart envelope pushes it slightly over", () => {
    expect(rejectOversizeRequest(requestWithLength(String(MAX_UPLOAD_SIZE_BYTES + 512)))).toBeNull();
  });

  it("allows a body under the cap", () => {
    expect(rejectOversizeRequest(requestWithLength("1024"))).toBeNull();
  });

  it("defers to the per-file check when Content-Length is absent (chunked upload)", () => {
    expect(rejectOversizeRequest(requestWithLength(null))).toBeNull();
  });

  it("defers rather than throwing on a malformed Content-Length", () => {
    expect(rejectOversizeRequest(requestWithLength("not-a-number"))).toBeNull();
    expect(rejectOversizeRequest(requestWithLength("-1"))).toBeNull();
  });

  it("honors an admin-configured cap lower than the default", () => {
    expect(rejectOversizeRequest(requestWithLength(String(2 * 1024 * 1024)), 1024 * 1024)).not.toBeNull();
  });
});

describe("rejectOversizeFile", () => {
  it("rejects on File.size, before arrayBuffer() copies the bytes", () => {
    const error = rejectOversizeFile(fileOfSize(500 * 1024 * 1024));
    expect(error?.code).toBe("FILE_PROCESSING_ERROR");
    expect(error?.details?.reason).toBe("too_large");
    expect(error?.details?.fileName).toBe("big.pdf");
  });

  it("allows a file at exactly the cap", () => {
    expect(rejectOversizeFile(fileOfSize(MAX_UPLOAD_SIZE_BYTES))).toBeNull();
  });

  it("rejects one byte over the cap", () => {
    expect(rejectOversizeFile(fileOfSize(MAX_UPLOAD_SIZE_BYTES + 1))).not.toBeNull();
  });

  it("honors an admin-configured cap", () => {
    expect(rejectOversizeFile(fileOfSize(2 * 1024 * 1024), 1024 * 1024)).not.toBeNull();
  });

  it("states the effective cap in the user-facing message, not the hard-coded default", () => {
    expect(rejectOversizeFile(fileOfSize(5 * 1024 * 1024), 2 * 1024 * 1024)?.message).toContain("2MB");
  });
});
