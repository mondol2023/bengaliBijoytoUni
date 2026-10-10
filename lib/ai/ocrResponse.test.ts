import { describe, expect, it } from "vitest";
import { OCR_AI_LIMITS } from "@/lib/ocr/limits";
import { parseOcrResponse } from "./ocrResponse";

const json = (images: unknown) => JSON.stringify({ images });

function expectInvalid(raw: string, count = 2) {
  const result = parseOcrResponse("gemini", raw, count);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("provider_invalid_response");
    expect(JSON.stringify(result.error.debug ?? "")).not.toContain("SENTINEL");
  }
}

describe("parseOcrResponse", () => {
  it("returns one text per image in index order", () => {
    const result = parseOcrResponse(
      "gemini",
      json([
        { index: 1, text: "ক" },
        { index: 2, text: "খ" },
      ]),
      2,
    );
    expect(result).toEqual({ ok: true, value: ["ক", "খ"] });
  });

  it("returns entries in index order when the model sends them reversed", () => {
    const result = parseOcrResponse(
      "gemini",
      json([
        { index: 2, text: "খ" },
        { index: 1, text: "ক" },
      ]),
      2,
    );
    expect(result).toEqual({ ok: true, value: ["ক", "খ"] });
  });

  it("trims surrounding whitespace only", () => {
    const result = parseOcrResponse("gemini", json([{ index: 1, text: "  নং ৪৫ \n" }]), 1);
    expect(result).toEqual({ ok: true, value: ["নং ৪৫"] });
  });

  it("rejects too few entries", () => expectInvalid(json([{ index: 1, text: "ক" }])));

  it("rejects too many entries", () =>
    expectInvalid(
      json([
        { index: 1, text: "ক" },
        { index: 2, text: "খ" },
        { index: 3, text: "গ" },
      ]),
    ));

  it("rejects a duplicate index", () =>
    expectInvalid(
      json([
        { index: 1, text: "ক" },
        { index: 1, text: "খ" },
      ]),
    ));

  it.each([3, 0, -1, 1.5])("rejects out-of-range index %s", (index) =>
    expectInvalid(
      json([
        { index: 1, text: "ক" },
        { index, text: "খ" },
      ]),
    ),
  );

  it("rejects a non-string text", () =>
    expectInvalid(
      json([
        { index: 1, text: "ক" },
        { index: 2, text: 5 },
      ]),
    ));

  // Measured live: Gemini answers "" for a blank crop, a logo or a ruled line. That is a reading
  // ("no text here"), not a malformed answer, and must not cost the other crops in the call theirs.
  it.each(["", "   \n"])("accepts an empty text %j as 'no text in this image'", (text) => {
    const result = parseOcrResponse(
      "gemini",
      json([
        { index: 1, text: "ক" },
        { index: 2, text },
      ]),
      2,
    );
    expect(result).toEqual({ ok: true, value: ["ক", ""] });
  });

  it("rejects fenced JSON and prose around the JSON", () => {
    const body = json([
      { index: 1, text: "ক" },
      { index: 2, text: "খ" },
    ]);
    expectInvalid("```json\n" + body + "\n```");
    expectInvalid("Here you go: " + body);
  });

  it("rejects a text over the cap, without echoing it into debug", () => {
    expectInvalid(
      json([
        { index: 1, text: "ক" },
        { index: 2, text: "SENTINEL" + "খ".repeat(OCR_AI_LIMITS.maxTextChars) },
      ]),
    );
  });

  it("rejects garbage that is not JSON, without echoing it into debug", () => {
    expectInvalid("SENTINEL not json");
  });
});
